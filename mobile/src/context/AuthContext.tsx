import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, getTokens, setAuthLostHandler, setTokens } from '../lib/api';
import { unregisterDevice } from '../lib/notifications';
import { StorageKeys, getItem } from '../lib/secure-storage';
import type { Tokens, User } from '../lib/types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: User | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setAuthLostHandler(() => {
      setUser(null);
      setStatus('signedOut');
    });
    (async () => {
      const raw = await getItem(StorageKeys.tokens);
      if (!raw) return setStatus('signedOut');
      await setTokens(JSON.parse(raw) as Tokens);
      try {
        setUser(await api<User>('/users/me'));
        setStatus('signedIn');
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          // Offline: keep the session; screens retry when the network returns.
          setStatus('signedIn');
        } else {
          await setTokens(null);
          setStatus('signedOut');
        }
      }
    })();
  }, []);

  const startSession = useCallback(async (path: string, email: string, password: string) => {
    const res = await api<{ user: User; tokens: Tokens }>(path, { method: 'POST', auth: false, body: { email, password } });
    await setTokens(res.tokens);
    setUser(res.user);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    await unregisterDevice();
    const refreshToken = getTokens()?.refreshToken;
    if (refreshToken) await api('/auth/logout', { method: 'POST', auth: false, body: { refreshToken } }).catch(() => undefined);
    await setTokens(null);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      signIn: (e, p) => startSession('/auth/login', e, p),
      signUp: (e, p) => startSession('/auth/register', e, p),
      signOut,
    }),
    [status, user, startSession, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
