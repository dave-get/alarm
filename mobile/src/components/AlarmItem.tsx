import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SYMBOL_META, type CryptoSymbol } from '../lib/config';
import { distancePercent, formatPrice, timeAgo } from '../lib/format';
import { useTheme } from '../lib/theme';
import type { Alarm } from '../lib/types';
import { Badge } from './ui';

/** Active alarm row with live percentage distance to target (plan §9). */
export function AlarmItem({
  alarm,
  livePrice,
  onPress,
  onToggle,
  onDelete,
}: {
  alarm: Alarm;
  livePrice?: string | null;
  onPress: () => void;
  onToggle?: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const base = SYMBOL_META[alarm.symbol as CryptoSymbol]?.base ?? alarm.symbol;
  const current = livePrice ?? alarm.currentPrice ?? null;
  const dist = alarm.status === 'ACTIVE' || alarm.status === 'PAUSED' ? distancePercent(current, alarm.targetPrice) : null;
  const statusColor = alarm.status === 'ACTIVE' ? t.up : alarm.status === 'TRIGGERED' ? t.accent : t.muted;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.title, { color: t.text }]}>
            {base} {alarm.condition === 'ABOVE' ? '≥' : '≤'} {formatPrice(alarm.targetPrice)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Badge label={alarm.status} color={statusColor} />
          <Badge label={alarm.mode === 'ONCE' ? 'ONCE' : 'RECURRING'} color={t.muted} />
          {alarm.mode === 'RECURRING' && !alarm.armed && alarm.status === 'ACTIVE' ? <Badge label="WAITING TO REARM" color={t.warn} /> : null}
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>
          Now {formatPrice(current)}
          {dist !== null ? ` · ${Number(dist) > 0 ? '+' : ''}${dist}% to target` : ''}
          {alarm.triggeredAt ? ` · triggered ${timeAgo(alarm.triggeredAt)} at ${formatPrice(alarm.triggeredPrice)}` : ''}
        </Text>
      </View>
      <View style={{ gap: 8 }}>
        {onToggle ? (
          <Pressable accessibilityRole="button" onPress={onToggle} hitSlop={8}>
            <Text style={{ color: t.primary, fontWeight: '700' }}>
              {alarm.status === 'ACTIVE' ? 'Pause' : alarm.status === 'TRIGGERED' ? 'Re-arm' : 'Resume'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onDelete} hitSlop={8}>
          <Text style={{ color: t.danger, fontWeight: '700' }}>Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: '700' },
});
