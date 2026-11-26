# Crypto Price Alerts — mobile app (Expo SDK 58, Expo Router)

Live prices for BTC, ETH, BNB, XRP and SOL (vs USDT), above/below price alarms, and push
notifications that arrive while the app is closed. Prices and alarms are evaluated on the server;
the app talks only to the NestJS backend (REST + Socket.IO), never directly to Binance.

## Screens (`src/app`)

| Route | Purpose |
|---|---|
| `(auth)/login`, `(auth)/register` | Email + password; tokens are stored in SecureStore |
| `(tabs)/index` | Live dashboard: five price cards, connection status, "Create alarm" |
| `(tabs)/alarms` | Active / paused / triggered alarms with live % distance to target; pause, resume, re-arm, delete |
| `(tabs)/history` | Alarm trigger history and notification history (mark read) |
| `(tabs)/settings` | Notification permission, device registration, test push, sound/channel settings, sign out |
| `alarm/new` | Symbol, target price, ABOVE/BELOW, ONCE/RECURRING (cooldown, rearm margin); warns when the condition is already met |
| `alarm/[id]` | Details, edit, pause/resume/re-arm/cancel, trigger history |

## Run

```bash
cp .env.example .env          # set EXPO_PUBLIC_API_URL to your backend
npm install
npx expo start
```

- **Push notifications need a development build on a physical device**: Expo Go and simulators
  can't receive remote push. Run `npx eas-cli@latest init` (fills the EAS project ID), configure
  credentials (`npx eas-cli@latest credentials`: FCM V1 key for Android, APNs key for iOS), then
  `npx eas-cli@latest build --profile development`.
- Android: the app creates the `price-alerts` notification channel (max importance, sound,
  vibration). The backend sends every price alert on that channel.
- iOS: notification permission is requested from Settings → "Enable notifications".

Push can arrive while the app is closed, but sound, silent mode, Focus/Do Not Disturb, battery
savers and timing are controlled by the OS. It is not a guaranteed native wake-up alarm.

## Checks

```bash
npx tsc --noEmit
npx expo lint
```
