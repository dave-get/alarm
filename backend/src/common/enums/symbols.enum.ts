/** Plan §1: BTC, ETH, BNB, XRP and SOL against USDT. The symbol allowlist. */
export const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT'] as const;
export type CryptoSymbol = (typeof SUPPORTED_SYMBOLS)[number];

export const SYMBOL_META: Record<CryptoSymbol, { base: string; quote: string; name: string }> = {
  BTCUSDT: { base: 'BTC', quote: 'USDT', name: 'Bitcoin' },
  ETHUSDT: { base: 'ETH', quote: 'USDT', name: 'Ethereum' },
  BNBUSDT: { base: 'BNB', quote: 'USDT', name: 'BNB' },
  XRPUSDT: { base: 'XRP', quote: 'USDT', name: 'XRP' },
  SOLUSDT: { base: 'SOL', quote: 'USDT', name: 'Solana' },
};

export function isSupportedSymbol(value: unknown): value is CryptoSymbol {
  return typeof value === 'string' && (SUPPORTED_SYMBOLS as readonly string[]).includes(value);
}
