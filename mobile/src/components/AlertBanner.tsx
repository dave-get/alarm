import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useMarket } from '../context/MarketContext';
import { formatPrice } from '../lib/format';
import { useTheme } from '../lib/theme';

/** In-app banner for `alert:triggered` while the app is open (push covers the closed app). */
export function AlertBanner() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { lastAlert, dismissAlert } = useMarket();

  useEffect(() => {
    if (!lastAlert) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    const timer = setTimeout(dismissAlert, 8000);
    return () => clearTimeout(timer);
  }, [lastAlert, dismissAlert]);

  if (!lastAlert) return null;
  return (
    <Pressable
      accessibilityRole="alert"
      onPress={() => {
        dismissAlert();
        router.push(`/alarm/${lastAlert.alertId}`);
      }}
      style={[styles.banner, { top: insets.top + 8, backgroundColor: t.accent }]}
    >
      <Text style={styles.title}>{lastAlert.symbol} Price Alert</Text>
      <Text style={styles.body}>
        {lastAlert.symbol} reached {formatPrice(lastAlert.triggeredPrice)} USDT. Target: {formatPrice(lastAlert.targetPrice)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 14,
    padding: 14,
    zIndex: 100,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  title: { color: '#0B0E11', fontWeight: '800', fontSize: 15 },
  body: { color: '#0B0E11', marginTop: 2 },
});
