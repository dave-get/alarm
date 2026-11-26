import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AlarmItem } from '../../components/AlarmItem';
import { Button, EmptyState, SectionTitle } from '../../components/ui';
import { useMarket } from '../../context/MarketContext';
import { useTheme } from '../../lib/theme';
import { useAlarms } from '../../lib/useAlarms';

/** Active alarm management (plan §15 Phase 5). */
export default function AlarmsScreen() {
  const t = useTheme();
  const { prices } = useMarket();
  const { alarms, loading, error, reload, pause, resume, remove } = useAlarms();
  const [refreshing, setRefreshing] = useState(false);

  const sections = useMemo(
    () =>
      [
        { title: 'Active', data: alarms.filter((a) => a.status === 'ACTIVE') },
        { title: 'Paused', data: alarms.filter((a) => a.status === 'PAUSED') },
        { title: 'Triggered', data: alarms.filter((a) => a.status === 'TRIGGERED') },
      ].filter((s) => s.data.length > 0),
    [alarms],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(a) => a.id}
      contentContainerStyle={styles.container}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={t.primary}
          onRefresh={async () => {
            setRefreshing(true);
            await reload();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
          <Button title="New alarm" onPress={() => router.push('/alarm/new')} />
        </View>
      }
      ListEmptyComponent={<EmptyState title="No alarms yet" message="Create one to get a push notification when a price is reached." />}
      renderSectionHeader={({ section }) => <SectionTitle>{`${section.title} (${section.data.length})`}</SectionTitle>}
      renderItem={({ item }) => (
        <AlarmItem
          alarm={item}
          livePrice={prices[item.symbol]?.price}
          onPress={() => router.push(`/alarm/${item.id}`)}
          onToggle={() => (item.status === 'ACTIVE' ? pause(item.id) : resume(item.id))}
          onDelete={() => remove(item.id)}
        />
      )}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 4 },
});
