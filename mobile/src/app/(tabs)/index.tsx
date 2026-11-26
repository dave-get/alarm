import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { ConnectionBadge, FeedWarning } from '../../components/ConnectionBadge';
import { PriceCard } from '../../components/PriceCard';
import { Button } from '../../components/ui';
import { useMarket } from '../../context/MarketContext';
import { SUPPORTED_SYMBOLS } from '../../lib/config';
import { useTheme } from '../../lib/theme';
import { useAlarms } from '../../lib/useAlarms';

/** Live dashboard (plan §9 Mobile UI): five price cards, connection status, create alarm. */
export default function MarketsScreen() {
  const t = useTheme();
  const { prices, refresh } = useMarket();
  const { alarms } = useAlarms();
  const [refreshing, setRefreshing] = useState(false);

  const activeBySymbol = (symbol: string) => alarms.filter((a) => a.symbol === symbol && a.status === 'ACTIVE').length;

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <View style={{ marginRight: 16 }}><ConnectionBadge /></View> }} />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        <FeedWarning />
        <Text style={{ color: t.muted }}>Spot prices vs USDT from Binance. Tap a coin to set an alarm.</Text>
        {SUPPORTED_SYMBOLS.map((s) => (
          <PriceCard key={s} symbol={s} tick={prices[s]} alarmCount={activeBySymbol(s)} onPress={() => router.push({ pathname: '/alarm/new', params: { symbol: s } })} />
        ))}
        <Button title="Create alarm" onPress={() => router.push('/alarm/new')} style={{ marginTop: 8 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
});
