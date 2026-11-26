# Crypto Price Alert App

Monitors **BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT and SOLUSDT** on Binance and sends push notifications
when a user's above/below price alarm is reached, even when the mobile app is closed.

```
Binance Spot WebSocket (aggTrade) ──► Market worker (NestJS) ──► Redis latest prices ──► API / Socket.IO ──► Mobile app
                                         │
                                         └─► Alert engine ──► PostgreSQL (alert event + outbox, one transaction)
                                                                   │
                                     Outbox dispatcher ◄───────────┘
                                         │ BullMQ (unique job id)
                                         ▼
                              Notification worker ──► Expo Push ──► FCM / APNs ──► device
```

| Folder | What |
|---|---|
| [backend/](backend/) | NestJS 12 + Prisma 7 (PostgreSQL) + Redis + BullMQ + Socket.IO + Swagger. One codebase, four process roles. |
| [mobile/](mobile/) | Expo SDK 58 / React Native app with Expo Router. |

## Quick start (local)

```bash
cd backend
cp .env.example .env           # set JWT_SECRET (>= 32 bytes): openssl rand -base64 32
docker compose up -d --build   # postgres, redis, migrate, api, market-worker, outbox-dispatcher, notification-worker
open http://localhost:3000/api/docs     # Swagger
curl http://localhost:3000/health/details

cd ../mobile
cp .env.example .env           # EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000
npm install && npx expo start
```

Without Docker, start Postgres and Redis yourself, then in `backend/`: `npm install`,
`npx prisma migrate deploy`, `npm run start:dev` (runs API + all workers in one process: `APP_ROLE=all`).

## Backend

### Process roles (`APP_ROLE` / entry points)

| Role | Entry | Does |
|---|---|---|
| `api` | `dist/main.js` | REST `/api/v1/*`, Socket.IO gateway, Swagger at `/api/docs`, `/health`, `/ready`, `/health/details` |
| `market` | `dist/workers/market.worker.js` | One shared Binance connection, gap recovery, checkpoints, alert engine. A Redis lease elects a single leader when several run. |
| `outbox` | `dist/workers/outbox.worker.js` | Publishes committed outbox rows to BullMQ (`FOR UPDATE SKIP LOCKED`, job id `outbox-<id>`) |
| `notifications` | `dist/workers/notification.worker.js` | Expo push, retries with backoff, receipts, disables invalid tokens |

### Market data (plan §3, §5, §12)
- Combined `@aggTrade` stream for the five symbols; every frame is schema-validated (zod).
- Heartbeat watchdog (any frame/ping/pong; client pings when quiet), reconnect with exponential
  backoff + jitter, and **planned rotation at 23h** with an overlapping replacement socket.
- Per-symbol ordered pipeline: duplicates and out-of-order trades are dropped by aggregate trade ID;
  a gap triggers REST backfill (`/api/v3/aggTrades?fromId=`, paginated by 1000) replayed in order
  before the live trade. Live trades wait in a bounded queue during recovery; overflow is recovered
  through the same backfill. Ranges that can't be recovered are stored in `market_gaps` and counted
  in `/health/details`. Nothing is skipped silently.
- Checkpoints (last evaluated trade per symbol) persist to PostgreSQL every 5s and on shutdown, so a
  restart backfills the downtime.
- REST `ticker/price` snapshot only seeds the display cache; it is never evaluated against alarms.
- Stale detection (no trade for 60s): prices are flagged `isStale`, and a stale price never triggers
  a newly created alarm. When the exchange is down, status is `UNAVAILABLE` and no price is invented.

### Alert engine (plan §6, §8)
- ABOVE ⇔ price ≥ target, BELOW ⇔ price ≤ target, using `decimal.js` (prices are strings end to end,
  `NUMERIC(24,12)` in PostgreSQL). A jump over the target triggers.
- In-memory **sorted threshold index** per symbol (binary search), restored from PostgreSQL on
  start, synced through Redis pub/sub on every alarm change and fully resynced every 60s.
- Every trade is evaluated; only UI broadcasts are throttled (`UI_BROADCAST_INTERVAL_MS`, default 1000).
- Trigger = one transaction: conditional `UPDATE … WHERE status='ACTIVE' AND armed` + `alert_events`
  row (unique `alertId+sequence`) + `outbox_events` row. Simultaneous trades can't double-trigger.
- ONCE → `TRIGGERED`. RECURRING → disarmed; rearms after the price leaves the condition by
  `rearmMarginPercent` **and** `cooldownSeconds` has passed.
- Creating an alarm whose condition a fresh price already satisfies returns a
  `CONDITION_ALREADY_MET` warning, and the alarm triggers right after creation.

### Notifications (plan §9)
User-facing `notifications` (history/read state, one per alert event) and per-device
`notification_deliveries` (unique per notification + device; status, ticket, receipt, error).
Only `PENDING` deliveries are (re)sent, so retries don't resend what Expo accepted. Transient
errors (`MessageRateExceeded`, network, 5xx) retry with exponential backoff. Receipts are checked
after 15 minutes. `DeviceNotRegistered` disables the token. Push is not exactly-once: a crash
between Expo accepting a chunk and the database recording it can resend that chunk.

### REST API (`/api/v1`, bearer auth except market + auth)

| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register · /auth/login · /auth/refresh · /auth/logout | Accounts, rotating refresh tokens (reuse revokes the family) |
| GET | /users/me | Current user |
| GET | /market/symbols · /market/prices · /market/prices/:symbol · /market/status | Public market data |
| POST/GET | /alerts | Create / list alarms |
| GET | /alerts/history · /alerts/:id | Trigger history, details |
| PATCH | /alerts/:id · /alerts/:id/pause · /alerts/:id/resume | Update, pause, resume (also re-arms a triggered alarm) |
| DELETE | /alerts/:id | Cancel |
| POST/GET/DELETE | /devices · /devices/:id | Push tokens |
| GET | /notifications | History (`?unread=true`) |
| PATCH | /notifications/:id/read | Mark read |
| POST | /notifications/test | Test push |

Responses are `{ "success": true, "data": … }`; errors are
`{ "success": false, "error": { statusCode, code, message } }`.

### Socket.IO (same origin as the API)

| Event | Direction | Payload |
|---|---|---|
| `market:subscribe` / `market:unsubscribe` | client → server | `{ symbols?: string[] }` (default: all five) |
| `market:price` | server → client | `{ symbol, price, source, timestamp, isStale }` |
| `market:status` | server → client | `{ connection, updatedAt, symbols }` |
| `alert:triggered` | server → owner only | `{ alertId, symbol, targetPrice, triggeredPrice, triggeredAt, … }` |
| `auth:ok` / `auth:error` / `auth:expired` | server → client | Send the access token as `auth: { token }` in the handshake |

### Security (plan §13)
JWT access tokens (15 min) + rotating refresh tokens stored as SHA-256; timing-safe password checks
(scrypt via `@nestjs/authentication`). Ownership checks on every alarm, device and notification
query (another user's alarm is a 404). Strict DTO validation (`forbidNonWhitelisted`), symbol
allowlist, positive decimal strings. Redis-backed rate limits (global plus tighter limits on sign-in,
alarm creation, device registration and test push). JSON logs with redacted secrets, HTTPS/WSS via
Nginx, graceful shutdown, health endpoints. No wallet, trading or withdrawal permissions.

### Deployment (plan §14)
`backend/docker-compose.yml` runs every process; `docker compose --profile https up -d` adds Nginx
(HTTPS + WSS, see [backend/nginx/README.md](backend/nginx/README.md)). Migrations run as a release
step (`migrate` service → `prisma migrate deploy`). Start with 2 vCPU / 4 GB RAM / 30 GB SSD and
adjust after load testing. Back up the `pgdata` volume (e.g. nightly `pg_dump`).

### Tests
```bash
cd backend
npm test                                          # unit: thresholds, jumps, decimals, duplicates, concurrency, rearm, gap recovery, parsing
E2E_BASE_URL=http://localhost:3000 npm run test:e2e   # against a running stack
```

## Notes and assumptions
- Binance public market data needs no API key. Verify regional availability and Binance's data
  redistribution terms before commercial use.
- Expo, Binance spot USDT prices and one-time alarms were recommended assumptions in the plan;
  recurring alarms are implemented as well.
- Prices in examples are illustrative. Push delivery and OS sound behaviour can only be verified on
  real Android/iOS devices with a development build (see [mobile/README.md](mobile/README.md)).
