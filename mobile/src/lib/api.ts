import { API_BASE } from './config';
import { StorageKeys, deleteItem, setItem } from './secure-storage';
import type { Tokens } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let tokens: Tokens | null = null;
let refreshing: Promise<Tokens | null> | null = null;
let onAuthLost: () => void = () => {};
const tokenListeners = new Set<(t: Tokens | null) => void>();

export function setAuthLostHandler(handler: () => void) {
  onAuthLost = handler;
}

export function onTokensChanged(listener: (t: Tokens | null) => void) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export function getTokens() {
  return tokens;
}

export async function setTokens(next: Tokens | null) {
  tokens = next;
  if (next) await setItem(StorageKeys.tokens, JSON.stringify(next));
  else await deleteItem(StorageKeys.tokens);
  tokenListeners.forEach((l) => l(next));
}

/** Single-flight refresh: concurrent 401s share one refresh call (refresh tokens rotate). */
export function refreshTokens(): Promise<Tokens | null> {
  if (!tokens?.refreshToken) return Promise.resolve(null);
  if (!refreshing) {
    const refreshToken = tokens.refreshToken;
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          if (res.status === 401) {
            await setTokens(null);
            onAuthLost();
          }
          return null;
        }
        const json = (await res.json()) as { data: Tokens };
        await setTokens(json.data);
        return json.data;
      } catch {
        return null; // network error: keep tokens, try later
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

/** Calls the API and unwraps `{ success, data }`. Throws ApiError with the server's message. */
export async function api<T>(path: string, { method = 'GET', body, auth = true, query }: RequestOptions = {}): Promise<T> {
  const qs = query
    ? '?' +
      Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';

  const send = (accessToken?: string) =>
    fetch(`${API_BASE}${path}${qs}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await send(tokens?.accessToken);
    if (res.status === 401 && auth && tokens) {
      const fresh = await refreshTokens();
      if (fresh) res = await send(fresh.accessToken);
    }
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = json?.error;
    const message = Array.isArray(err?.message) ? err.message.join('\n') : (err?.message ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, message);
  }
  return (json?.data ?? json) as T;
}
