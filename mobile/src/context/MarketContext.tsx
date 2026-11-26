import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { api, getTokens, onTokensChanged, refreshTokens } from '../lib/api';
import { API_URL, SUPPORTED_SYMBOLS } from '../lib/config';
import type { AlertTriggeredEvent, MarketStatus, PriceTick } from '../lib/types';

interface MarketValue {
  prices: Record<string, PriceTick | undefined>;
  status: MarketStatus | null;
  socketConnected: boolean;
  lastAlert: AlertTriggeredEvent | null;
  /** Increments on every alert:triggered so lists can refetch. */
  alertsVersion: number;
  dismissAlert(): void;
  refresh(): Promise<void>;
}

const MarketContext = createContext<MarketValue | null>(null);

/**
 * Plan §11: the app connects to the NestJS Socket.IO gateway (never to Binance),
 * subscribes to the five symbols, and fetches a fresh REST snapshot on every (re)connect
 * and when returning to the foreground.
 */
export function MarketProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<Record<string, PriceTick | undefined>>({});
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState<AlertTriggeredEvent | null>(null);
  const [alertsVersion, setAlertsVersion] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [snapshot, st] = await Promise.all([
        api<PriceTick[]>('/market/prices', { auth: false }),
        api<MarketStatus>('/market/status', { auth: false }),
      ]);
      setPrices((prev) => {
        const next = { ...prev };
        for (const p of snapshot) {
          const cur = next[p.symbol];
          // Keep a newer live tick over an older snapshot.
          if (!cur || (p.timestamp ?? 0) >= (cur.timestamp ?? 0)) next[p.symbol] = p;
        }
        return next;
      });
      setStatus(st);
    } catch {
      /* offline: the connection badge already says so */
    }
  }, []);

  useEffect(() => {
    const socket = io(API_URL, {
      transports: ['websocket'],
      // Called on every (re)connect, so a refreshed token is always used.
      auth: (cb) => cb({ token: getTokens()?.accessToken }),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('market:subscribe', { symbols: SUPPORTED_SYMBOLS });
      void refresh();
    });
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('market:price', (p: PriceTick) => setPrices((prev) => ({ ...prev, [p.symbol]: p })));
    socket.on('market:status', (s: MarketStatus) => setStatus(s));
    socket.on('alert:triggered', (e: AlertTriggeredEvent) => {
      setLastAlert(e);
      setAlertsVersion((v) => v + 1);
    });
    socket.on('auth:expired', async () => {
      await refreshTokens();
      socket.disconnect().connect();
    });

    // Sign-in / sign-out / token rotation: reconnect so the server puts us in the right private room.
    let lastAccess = getTokens()?.accessToken;
    const off = onTokensChanged((t) => {
      if (t?.accessToken === lastAccess) return;
      lastAccess = t?.accessToken;
      socket.disconnect().connect();
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!socket.connected) socket.connect();
      void refresh();
    });

    return () => {
      off();
      sub.remove();
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [refresh]);

  const value = useMemo<MarketValue>(
    () => ({ prices, status, socketConnected, lastAlert, alertsVersion, dismissAlert: () => setLastAlert(null), refresh }),
    [prices, status, socketConnected, lastAlert, alertsVersion, refresh],
  );
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used inside MarketProvider');
  return ctx;
}
