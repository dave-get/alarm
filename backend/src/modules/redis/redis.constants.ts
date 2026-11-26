export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Redis keys (plan §7) and pub/sub channels used between processes. */
export const RedisKeys = {
  price: (symbol: string) => `market:price:${symbol}`,
  checkpoint: (symbol: string) => `market:checkpoint:${symbol}`,
  marketStatus: 'market:status',
  marketLeader: 'market:ingestion:leader',
  workerHeartbeat: (role: string, instance: string) => `worker:heartbeat:${role}:${instance}`,
  workerHeartbeatPattern: (role: string) => `worker:heartbeat:${role}:*`,
  throttle: (key: string) => `throttle:${key}`,
} as const;

export const RedisChannels = {
  /** Market worker -> API: batches of latest prices (already throttled). */
  prices: 'market:prices',
  /** Market worker -> API: connection / staleness status. */
  status: 'market:status',
  /** API -> market worker: an alert was created/changed/removed; resync it. */
  alertChanged: 'alerts:changed',
  /** Notification worker -> API: push `alert:triggered` to the owner's sockets. */
  alertTriggered: 'alerts:triggered',
  /** Market worker -> outbox dispatcher: new outbox rows committed (low-latency nudge). */
  outboxNew: 'outbox:new',
} as const;

export const NOTIFICATIONS_QUEUE = 'notifications';

export const NotificationJobs = {
  alertTriggered: 'alert-triggered',
  sendNotification: 'send-notification',
  checkReceipts: 'check-receipts',
} as const;
