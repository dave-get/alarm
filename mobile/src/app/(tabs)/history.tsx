import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { EmptyState, Segmented } from '../../components/ui';
import { useMarket } from '../../context/MarketContext';
import { api } from '../../lib/api';
import { SYMBOL_META, type CryptoSymbol } from '../../lib/config';
import { formatDateTime, formatPrice } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import type { AlertEvent, AppNotification, Paginated } from '../../lib/types';

type Tab = 'triggers' | 'notifications';

/** Alarm history and notification history (plan §9, §15 Phase 5). */
export default function HistoryScreen() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('triggers');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'triggers', label: 'Alarm triggers' },
            { value: 'notifications', label: 'Notifications' },
          ]}
        />
      </View>
      {tab === 'triggers' ? <TriggerList /> : <NotificationList />}
      <View style={{ height: 1, backgroundColor: t.border }} />
    </View>
  );
}

function usePaged<T>(path: string) {
  const { alertsVersion } = useMarket();
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p = 1) => {
      try {
        const res = await api<Paginated<T>>(path, { query: { page: p, pageSize: 30 } });
        setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]));
        setPage(p);
        setTotal(res.total);
        setUnread(res.unreadCount ?? 0);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  // Refetch on focus, and again whenever an alarm triggers while this screen is focused.
  useFocusEffect(
    useCallback(() => {
      void load(1);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- alertsVersion: refetch when an alarm triggers
    }, [load, alertsVersion]),
  );

  return { items, setItems, loading, error, unread, setUnread, reload: () => load(1), more: () => (items.length < total ? load(page + 1) : undefined) };
}

function TriggerList() {
  const t = useTheme();
  const { items, loading, error, reload, more } = usePaged<AlertEvent>('/alerts/history');
  const [refreshing, setRefreshing] = useState(false);
  if (loading) return <ActivityIndicator style={{ marginTop: 32 }} color={t.primary} />;
  return (
    <FlatList
      data={items}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.list}
      onEndReached={() => void more()}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.primary} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      ListHeaderComponent={error ? <Text style={{ color: t.danger }}>{error}</Text> : undefined}
      ListEmptyComponent={<EmptyState title="No triggers yet" message="When an alarm fires it shows up here." />}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/alarm/${item.alertId}`)} style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>
            {SYMBOL_META[item.symbol as CryptoSymbol]?.base ?? item.symbol} reached {formatPrice(item.triggeredPrice)}
          </Text>
          <Text style={{ color: t.muted }}>
            Target {item.condition === 'ABOVE' ? '≥' : '≤'} {formatPrice(item.targetPrice)} · trigger #{item.sequence}
          </Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>
            {formatDateTime(item.triggeredAt)} · trade {item.tradeId}
          </Text>
        </Pressable>
      )}
    />
  );
}

function NotificationList() {
  const t = useTheme();
  const { items, setItems, loading, error, unread, setUnread, reload, more } = usePaged<AppNotification>('/notifications');
  const [refreshing, setRefreshing] = useState(false);

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread(Math.max(0, unread - 1));
      await api(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    }
    const alertId = n.data?.alertId;
    if (typeof alertId === 'string') router.push(`/alarm/${alertId}`);
  };

  if (loading) return <ActivityIndicator style={{ marginTop: 32 }} color={t.primary} />;
  return (
    <FlatList
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={styles.list}
      onEndReached={() => void more()}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.primary} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View>
          {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
          <Text style={{ color: t.muted, marginBottom: 8 }}>{unread} unread</Text>
        </View>
      }
      ListEmptyComponent={<EmptyState title="No notifications" message="Price alerts and test pushes appear here." />}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      renderItem={({ item }) => {
        const delivered = item.deliveries.some((d) => d.status === 'DELIVERED' || d.status === 'SENT');
        const failed = item.deliveries.length > 0 && item.deliveries.every((d) => d.status === 'FAILED');
        return (
          <Pressable onPress={() => void open(item)} style={[styles.row, { backgroundColor: t.card, borderColor: item.readAt ? t.border : t.primary }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {!item.readAt ? <View style={[styles.dot, { backgroundColor: t.primary }]} /> : null}
              <Text style={{ color: t.text, fontWeight: '700', flex: 1 }}>{item.title}</Text>
            </View>
            <Text style={{ color: t.text }}>{item.body}</Text>
            <Text style={{ color: failed ? t.danger : t.muted, fontSize: 12 }}>
              {formatDateTime(item.createdAt)} ·{' '}
              {item.deliveries.length === 0 ? 'no device registered' : failed ? 'push failed' : delivered ? 'pushed' : 'sending…'}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingTop: 8 },
  row: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
