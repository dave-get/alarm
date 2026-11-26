import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/**
 * Environment contract. Validated once at startup: a missing or malformed
 * variable stops the process before it serves anything (see .env.example).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Comma separated: api, market, outbox, notifications, or all. */
  APP_ROLE: z.string().default('all'),
  LOG_JSON: bool.optional(),
  LOG_LEVEL: z.enum(['debug', 'verbose', 'log', 'warn', 'error']).default('log'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  JWT_SECRET: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') >= 32, 'JWT_SECRET must be at least 32 bytes (openssl rand -base64 32)'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  JWT_REFRESH_ABSOLUTE_TTL: z.string().default('90d'),
  JWT_ISSUER: z.string().default('crypto-price-alerts'),
  JWT_AUDIENCE: z.string().default('crypto-price-alerts-app'),

  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: bool.default(true),
  SWAGGER_ENABLED: bool.default(true),

  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  BINANCE_WS_URL: z.string().url().default('wss://stream.binance.com:9443'),
  BINANCE_REST_URL: z.string().url().default('https://api.binance.com'),
  /** No frame at all (data, ping or pong) for this long => connection is considered dead. */
  MARKET_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** No trade for a symbol for this long => its price is stale. */
  MARKET_STALE_AFTER_MS: z.coerce.number().int().positive().default(60_000),
  /** Binance closes connections after 24h; rotate before that. */
  MARKET_ROTATE_AFTER_MS: z.coerce.number().int().positive().default(23 * 60 * 60 * 1000),
  MARKET_MAX_BACKFILL_TRADES: z.coerce.number().int().positive().default(100_000),
  MARKET_QUEUE_MAX: z.coerce.number().int().positive().default(10_000),
  MARKET_CACHE_FLUSH_MS: z.coerce.number().int().positive().default(250),
  MARKET_CHECKPOINT_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  LEADER_LOCK_TTL_MS: z.coerce.number().int().positive().default(15_000),

  UI_BROADCAST_INTERVAL_MS: z.coerce.number().int().min(250).max(5_000).default(1_000),

  ALERT_RESYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  MAX_ACTIVE_ALERTS_PER_USER: z.coerce.number().int().positive().default(100),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(100),

  EXPO_ACCESS_TOKEN: z.string().optional(),
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  RECEIPT_CHECK_DELAY_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RECEIPT_CHECK_EVERY_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
