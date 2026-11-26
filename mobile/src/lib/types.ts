export type Condition = 'ABOVE' | 'BELOW';
export type AlarmMode = 'ONCE' | 'RECURRING';
export type AlarmStatus = 'ACTIVE' | 'TRIGGERED' | 'PAUSED' | 'CANCELLED';
export type MarketConnection = 'CONNECTING' | 'CONNECTED' | 'RECOVERING' | 'DISCONNECTED' | 'UNAVAILABLE';

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}

export interface PriceTick {
  symbol: string;
  price: string | null;
  source: string;
  timestamp: number | null;
  isStale: boolean;
}

export interface MarketStatus {
  connection: MarketConnection;
  source?: string;
  updatedAt: number;
  symbols: Record<string, { stale: boolean; recovering: boolean } | undefined>;
}

export interface Alarm {
  id: string;
  symbol: string;
  targetPrice: string;
  condition: Condition;
  status: AlarmStatus;
  mode: AlarmMode;
  armed: boolean;
  cooldownSeconds: number;
  rearmMarginPercent: string;
  triggerCount: number;
  triggeredPrice: string | null;
  triggeredAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentPrice?: string | null;
  isStale?: boolean;
  distancePercent?: string | null;
  warning?: { code: string; message: string };
  recentEvents?: AlertEvent[];
}

export interface AlertEvent {
  id: string;
  alertId: string;
  sequence: number;
  symbol: string;
  condition: Condition;
  targetPrice: string;
  triggeredPrice: string;
  triggeredAt: string;
  tradeId: string;
}

export interface AppNotification {
  id: string;
  type: 'PRICE_ALERT' | 'TEST';
  title: string;
  body: string;
  data: Record<string, unknown>;
  alertEventId: string | null;
  readAt: string | null;
  createdAt: string;
  deliveries: { deviceId: string; status: string; error: string | null; sentAt: string | null }[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount?: number;
}

export interface AlertTriggeredEvent {
  notificationId: string;
  alertEventId: string;
  alertId: string;
  symbol: string;
  condition: Condition;
  mode: AlarmMode;
  targetPrice: string;
  triggeredPrice: string;
  triggeredAt: string;
}
