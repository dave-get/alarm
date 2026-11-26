import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Decimal } from 'decimal.js';
import { useMarket } from '../context/MarketContext';
import { SUPPORTED_SYMBOLS, SYMBOL_META, type CryptoSymbol } from '../lib/config';
import { distancePercent, formatPrice, isConditionMet, isValidPrice } from '../lib/format';
import { useTheme } from '../lib/theme';
import type { AlarmMode, Condition } from '../lib/types';
import { Button, Field, Segmented } from './ui';

export interface AlarmFormValue {
  symbol: CryptoSymbol;
  targetPrice: string;
  condition: Condition;
  mode: AlarmMode;
  cooldownMinutes: string;
  rearmMarginPercent: string;
}

/** Target and condition selection (plan §9). Shared by create and edit. */
export function AlarmForm({
  initial,
  lockSymbol,
  submitLabel,
  onSubmit,
}: {
  initial: AlarmFormValue;
  lockSymbol?: boolean;
  submitLabel: string;
  onSubmit: (v: AlarmFormValue, ctx: { conditionMet: boolean; currentPrice: string | null; isStale: boolean }) => Promise<void>;
}) {
  const t = useTheme();
  const { prices } = useMarket();
  const [v, setV] = useState<AlarmFormValue>(initial);
  const [touchedCondition, setTouchedCondition] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tick = prices[v.symbol];
  const current = tick?.price ?? null;
  const set = (patch: Partial<AlarmFormValue>) => setV((prev) => ({ ...prev, ...patch }));

  const onTarget = (text: string) => {
    const cleaned = text.replace(',', '.').replace(/[^\d.]/g, '');
    const patch: Partial<AlarmFormValue> = { targetPrice: cleaned };
    // Suggest the natural condition from the live price until the user picks one.
    if (!touchedCondition && current && isValidPrice(cleaned)) {
      patch.condition = new Decimal(cleaned).gte(current) ? 'ABOVE' : 'BELOW';
    }
    set(patch);
  };

  const nudge = (pct: number) => {
    if (!current) return;
    const dp = new Decimal(current).gte(1000) ? 2 : new Decimal(current).gte(1) ? 4 : 6;
    const target = new Decimal(current).mul(1 + pct / 100).toDecimalPlaces(dp).toString();
    set({ targetPrice: target, condition: touchedCondition ? v.condition : pct >= 0 ? 'ABOVE' : 'BELOW' });
  };

  const validTarget = isValidPrice(v.targetPrice);
  const dist = validTarget ? distancePercent(current, v.targetPrice) : null;
  const met = validTarget && !tick?.isStale && isConditionMet(current, v.targetPrice, v.condition);

  const recurringError = useMemo(() => {
    if (v.mode !== 'RECURRING') return null;
    const cd = Number(v.cooldownMinutes);
    if (!Number.isInteger(cd) || cd < 0 || cd > 1440) return 'Cooldown must be 0–1440 minutes';
    if (!isValidPrice(v.rearmMarginPercent) || new Decimal(v.rearmMarginPercent).gt(50)) return 'Rearm margin must be between 0 and 50%';
    return null;
  }, [v.mode, v.cooldownMinutes, v.rearmMarginPercent]);

  const submit = async () => {
    setError(null);
    if (!validTarget) return setError('Enter a positive price (up to 12 decimals).');
    if (recurringError) return setError(recurringError);
    setSubmitting(true);
    try {
      await onSubmit(v, { conditionMet: met, currentPrice: current, isStale: !!tick?.isStale });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ gap: 18 }}>
      {!lockSymbol ? (
        <View style={styles.chips}>
          {SUPPORTED_SYMBOLS.map((s) => {
            const active = s === v.symbol;
            return (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => set({ symbol: s })}
                style={[styles.chip, { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primary : t.card }]}
              >
                <Text style={{ color: active ? t.primaryText : t.text, fontWeight: '700' }}>{SYMBOL_META[s].base}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[styles.priceBox, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={{ color: t.muted }}>{SYMBOL_META[v.symbol].name} now</Text>
        <Text style={{ color: tick?.isStale ? t.muted : t.text, fontSize: 26, fontWeight: '800' }}>
          {formatPrice(current)} <Text style={{ fontSize: 14, color: t.muted }}>USDT{tick?.isStale ? ' · stale' : ''}</Text>
        </Text>
      </View>

      <Field
        label="Target price (USDT)"
        value={v.targetPrice}
        onChangeText={onTarget}
        keyboardType="decimal-pad"
        placeholder={current ?? '0.00'}
        hint={dist !== null ? `${Number(dist) > 0 ? '+' : ''}${dist}% from current price` : undefined}
      />
      <View style={styles.chips}>
        {[-5, -1, 1, 5].map((p) => (
          <Pressable key={p} onPress={() => nudge(p)} style={[styles.chip, { borderColor: t.border, backgroundColor: t.card }]} disabled={!current}>
            <Text style={{ color: t.text }}>{p > 0 ? `+${p}%` : `${p}%`}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ color: t.muted, fontWeight: '600', fontSize: 13 }}>Condition</Text>
        <Segmented
          value={v.condition}
          onChange={(c) => {
            setTouchedCondition(true);
            set({ condition: c });
          }}
          options={[
            { value: 'ABOVE', label: 'Price ≥ target' },
            { value: 'BELOW', label: 'Price ≤ target' },
          ]}
        />
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ color: t.muted, fontWeight: '600', fontSize: 13 }}>Repeat</Text>
        <Segmented
          value={v.mode}
          onChange={(m) => set({ mode: m })}
          options={[
            { value: 'ONCE', label: 'Once' },
            { value: 'RECURRING', label: 'Recurring' },
          ]}
        />
      </View>

      {v.mode === 'RECURRING' ? (
        <View style={{ gap: 12 }}>
          <Field label="Cooldown (minutes)" value={v.cooldownMinutes} onChangeText={(x) => set({ cooldownMinutes: x.replace(/\D/g, '') })} keyboardType="number-pad" hint="Minimum time between two triggers" />
          <Field
            label="Rearm margin (%)"
            value={v.rearmMarginPercent}
            onChangeText={(x) => set({ rearmMarginPercent: x.replace(',', '.').replace(/[^\d.]/g, '') })}
            keyboardType="decimal-pad"
            hint="How far the price must move back before the alarm can fire again"
          />
        </View>
      ) : null}

      {met ? (
        <View style={[styles.warn, { backgroundColor: t.warnBg, borderColor: t.warn }]}>
          <Text style={{ color: t.text }}>
            {SYMBOL_META[v.symbol].base} is already {v.condition === 'ABOVE' ? 'at or above' : 'at or below'} this target. The alarm will trigger right after you save it.
          </Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
      <Button title={submitLabel} onPress={submit} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  priceBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 2 },
  warn: { borderWidth: 1, borderRadius: 12, padding: 12 },
});
