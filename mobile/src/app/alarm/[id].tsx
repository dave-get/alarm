import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AlarmForm } from '../../components/AlarmForm';
import { Badge, Button, Card, SectionTitle } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../context/MarketContext';
import { api } from '../../lib/api';
import { SYMBOL_META, type CryptoSymbol } from '../../lib/config';
import { distancePercent, formatDateTime, formatPrice } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import type { Alarm } from '../../lib/types';

/** Alarm details, edit, pause / resume / cancel (plan §10: GET/PATCH/DELETE /alerts/:id). */
export default function AlarmDetailScreen() {
  const t = useTheme();
  const { status } = useAuth();
  const { prices, alertsVersion } = useMarket();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setAlarm(await api<Alarm>(`/alerts/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- alertsVersion: refetch when an alarm triggers
    }, [load, alertsVersion]),
  );

  if (status === 'signedOut') return <Redirect href="/login" />;
  if (error) return <Text style={{ color: t.danger, padding: 16 }}>{error}</Text>;
  if (!alarm) return <ActivityIndicator style={{ marginTop: 32 }} color={t.primary} />;

  const live = prices[alarm.symbol]?.price ?? alarm.currentPrice ?? null;
  const dist = distancePercent(live, alarm.targetPrice);
  const base = SYMBOL_META[alarm.symbol as CryptoSymbol]?.base ?? alarm.symbol;
  const editable = alarm.status === 'ACTIVE' || alarm.status === 'PAUSED';

  const act = async (path: string, method: 'PATCH' | 'DELETE') => {
    try {
      await api(path, { method });
      if (method === 'DELETE') router.back();
      else await load();
    } catch (e) {
      Alert.alert('Could not update alarm', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}>
      <Stack.Screen options={{ title: `${base} alarm` }} />
      <Card style={{ gap: 8 }}>
        <Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>
          {base} {alarm.condition === 'ABOVE' ? '≥' : '≤'} {formatPrice(alarm.targetPrice)} USDT
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Badge label={alarm.status} color={alarm.status === 'ACTIVE' ? t.up : alarm.status === 'TRIGGERED' ? t.accent : t.muted} />
          <Badge label={alarm.mode} color={t.muted} />
        </View>
        <Text style={{ color: t.muted }}>
          Current {formatPrice(live)}
          {dist !== null && editable ? ` · ${Number(dist) > 0 ? '+' : ''}${dist}% to target` : ''}
        </Text>
        {alarm.mode === 'RECURRING' ? (
          <Text style={{ color: t.muted }}>
            Cooldown {Math.round(alarm.cooldownSeconds / 60)} min · rearm margin {alarm.rearmMarginPercent}% · {alarm.armed ? 'armed' : 'waiting to rearm'}
          </Text>
        ) : null}
        <Text style={{ color: t.muted }}>
          Triggered {alarm.triggerCount} time{alarm.triggerCount === 1 ? '' : 's'}
          {alarm.triggeredAt ? ` · last ${formatDateTime(alarm.triggeredAt)} at ${formatPrice(alarm.triggeredPrice)}` : ''}
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {alarm.status === 'ACTIVE' ? <Button title="Pause" variant="secondary" onPress={() => act(`/alerts/${alarm.id}/pause`, 'PATCH')} style={{ flex: 1 }} /> : null}
        {alarm.status === 'PAUSED' || alarm.status === 'TRIGGERED' ? (
          <Button title={alarm.status === 'PAUSED' ? 'Resume' : 'Re-arm'} variant="secondary" onPress={() => act(`/alerts/${alarm.id}/resume`, 'PATCH')} style={{ flex: 1 }} />
        ) : null}
        {alarm.status !== 'CANCELLED' ? (
          <Button
            title="Delete"
            variant="danger"
            style={{ flex: 1 }}
            onPress={() =>
              Alert.alert('Delete alarm?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => void act(`/alerts/${alarm.id}`, 'DELETE') },
              ])
            }
          />
        ) : null}
      </View>

      {editable ? (
        editing ? (
          <Card>
            <AlarmForm
              lockSymbol
              initial={{
                symbol: alarm.symbol as CryptoSymbol,
                targetPrice: alarm.targetPrice,
                condition: alarm.condition,
                mode: alarm.mode,
                cooldownMinutes: String(Math.round(alarm.cooldownSeconds / 60)),
                rearmMarginPercent: alarm.rearmMarginPercent,
              }}
              submitLabel="Save changes"
              onSubmit={async (v) => {
                await api(`/alerts/${alarm.id}`, {
                  method: 'PATCH',
                  body: {
                    targetPrice: v.targetPrice,
                    condition: v.condition,
                    mode: v.mode,
                    ...(v.mode === 'RECURRING' && { cooldownSeconds: Number(v.cooldownMinutes) * 60, rearmMarginPercent: v.rearmMarginPercent }),
                  },
                });
                setEditing(false);
                await load();
              }}
            />
          </Card>
        ) : (
          <Button title="Edit alarm" variant="secondary" onPress={() => setEditing(true)} />
        )
      ) : null}

      <SectionTitle>Trigger history</SectionTitle>
      {alarm.recentEvents?.length ? (
        alarm.recentEvents.map((e) => (
          <Card key={e.id} style={{ gap: 2 }}>
            <Text style={{ color: t.text, fontWeight: '700' }}>
              #{e.sequence} at {formatPrice(e.triggeredPrice)} USDT
            </Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>
              {formatDateTime(e.triggeredAt)} · trade {e.tradeId}
            </Text>
          </Card>
        ))
      ) : (
        <Text style={{ color: t.muted }}>Not triggered yet.</Text>
      )}
    </ScrollView>
  );
}
