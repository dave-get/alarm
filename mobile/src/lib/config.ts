import Constants from 'expo-constants';

/**
 * Backend base URL. Precedence: EXPO_PUBLIC_API_URL (e.g. in .env), then app.json `extra.apiUrl`.
 * On a physical device use your computer's LAN IP or the public HTTPS domain, not localhost.
 */
const fromEnv = process.env.EXPO_PUBLIC_API_URL;
const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export const API_URL = (fromEnv || fromConfig || 'http://localhost:3000').replace(/\/$/, '');
export const API_BASE = `${API_URL}/api/v1`;

/** EAS project ID, required by getExpoPushTokenAsync in builds. */
export const EAS_PROJECT_ID: string | undefined =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
  (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId ||
  undefined;

export const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT'] as const;
export type CryptoSymbol = (typeof SUPPORTED_SYMBOLS)[number];

export const SYMBOL_META: Record<CryptoSymbol, { base: string; name: string; color: string }> = {
  BTCUSDT: { base: 'BTC', name: 'Bitcoin', color: '#F7931A' },
  ETHUSDT: { base: 'ETH', name: 'Ethereum', color: '#627EEA' },
  BNBUSDT: { base: 'BNB', name: 'BNB', color: '#F0B90B' },
  XRPUSDT: { base: 'XRP', name: 'XRP', color: '#23292F' },
  SOLUSDT: { base: 'SOL', name: 'Solana', color: '#9945FF' },
};
