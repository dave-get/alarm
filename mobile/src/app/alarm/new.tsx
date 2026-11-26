import { Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { AlarmForm, type AlarmFormValue } from '../../components/AlarmForm';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { SUPPORTED_SYMBOLS, type CryptoSymbol } from '../../lib/config';
import type { Alarm } from '../../lib/types';

const confirm = (title: string, message: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Create anyway', onPress: () => resolve(true) },
    ]),
  );

/** Alarm creation (plan §10: POST /alerts). */
export default function NewAlarmScreen() {
  const { status } = useAuth();
  const params = useLocalSearchParams<{ symbol?: string }>();
  if (status === 'signedOut') return <Redirect href="/login" />;

  const symbol = (SUPPORTED_SYMBOLS as readonly string[]).includes(params.symbol ?? '') ? (params.symbol as CryptoSymbol) : 'BTCUSDT';
  const initial: AlarmFormValue = { symbol, targetPrice: '', condition: 'ABOVE', mode: 'ONCE', cooldownMinutes: '5', rearmMarginPercent: '0.5' };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <AlarmForm
          initial={initial}
          submitLabel="Create alarm"
          onSubmit={async (v, ctx) => {
            // Plan §6: warn in the UI when a fresh price already satisfies the new alarm.
            if (ctx.conditionMet && !(await confirm('Condition already met', 'This alarm will trigger immediately after creation.'))) return;
            const created = await api<Alarm>('/alerts', {
              method: 'POST',
              body: {
                symbol: v.symbol,
                targetPrice: v.targetPrice,
                condition: v.condition,
                mode: v.mode,
                ...(v.mode === 'RECURRING' && {
                  cooldownSeconds: Number(v.cooldownMinutes) * 60,
                  rearmMarginPercent: v.rearmMarginPercent,
                }),
              },
            });
            if (created.warning && !ctx.conditionMet) Alert.alert('Heads up', created.warning.message);
            router.back();
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
