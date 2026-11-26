import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useMarket } from '../context/MarketContext';
import { api } from './api';
import type { Alarm } from './types';

/** Alarms of the signed-in user, refetched on focus and whenever an alarm triggers. */
export function useAlarms() {
  const { alertsVersion } = useMarket();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAlarms(await api<Alarm[]>('/alerts'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alarms');
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch on focus, and again whenever an alarm triggers while the screen is focused.
  useFocusEffect(
    useCallback(() => {
      void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- alertsVersion: refetch when an alarm triggers
    }, [load, alertsVersion]),
  );

  const act = useCallback(
    async (path: string, method: 'PATCH' | 'DELETE') => {
      try {
        await api(path, { method });
        await load();
      } catch (e) {
        Alert.alert('Could not update alarm', e instanceof Error ? e.message : String(e));
      }
    },
    [load],
  );

  return {
    alarms,
    loading,
    error,
    reload: load,
    pause: (id: string) => act(`/alerts/${id}/pause`, 'PATCH'),
    resume: (id: string) => act(`/alerts/${id}/resume`, 'PATCH'),
    remove: (id: string) =>
      new Promise<void>((resolve) =>
        Alert.alert('Delete alarm?', 'It will stop monitoring this price.', [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
          { text: 'Delete', style: 'destructive', onPress: () => void act(`/alerts/${id}`, 'DELETE').then(resolve) },
        ]),
      ),
  };
}
