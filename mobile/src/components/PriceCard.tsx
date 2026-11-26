import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Decimal } from 'decimal.js';
import { SYMBOL_META, type CryptoSymbol } from '../lib/config';
import { formatPrice, timeAgo } from '../lib/format';
import { useTheme } from '../lib/theme';
import type { PriceTick } from '../lib/types';
import { Badge } from './ui';

/** One of the five live price cards (plan §9). Flashes green/red on each tick direction. */
export function PriceCard({ symbol, tick, onPress, alarmCount }: { symbol: CryptoSymbol; tick?: PriceTick; onPress: () => void; alarmCount: number }) {
  const t = useTheme();
  const meta = SYMBOL_META[symbol];
  const prev = useRef<string | null>(null);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const p = tick?.price ?? null;
    if (p && prev.current) {
      const cmp = new Decimal(p).cmp(new Decimal(prev.current));
      setDirection(cmp > 0 ? 'up' : cmp < 0 ? 'down' : null);
    }
    prev.current = p;
  }, [tick?.price]);

  const priceColor = tick?.isStale ? t.muted : direction === 'up' ? t.up : direction === 'down' ? t.down : t.text;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.name} ${formatPrice(tick?.price)} USDT${tick?.isStale ? ', stale' : ''}. Create alarm`}
      style={({ pressed }) => [styles.card, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.icon, { backgroundColor: meta.color }]}>
        <Text style={styles.iconText}>{meta.base.slice(0, 1)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.base, { color: t.text }]}>
          {meta.base}
          <Text style={{ color: t.muted, fontWeight: '400' }}> /USDT</Text>
        </Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>
          {meta.name}
          {alarmCount > 0 ? ` · ${alarmCount} alarm${alarmCount > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[styles.price, { color: priceColor }]}>{formatPrice(tick?.price)}</Text>
        {tick?.isStale ? <Badge label="STALE" color={t.warn} /> : <Text style={{ color: t.muted, fontSize: 11 }}>{timeAgo(tick?.timestamp)}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  base: { fontSize: 17, fontWeight: '700' },
  price: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
