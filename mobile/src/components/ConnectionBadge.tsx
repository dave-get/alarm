import { StyleSheet, Text, View } from 'react-native';
import { useMarket } from '../context/MarketContext';
import { useTheme } from '../lib/theme';

/** Plan §9 UI: market connection status. */
export function ConnectionBadge() {
  const t = useTheme();
  const { socketConnected, status } = useMarket();
  let label = 'Connecting…';
  let color = t.warn;
  if (!socketConnected) {
    label = 'Server offline';
    color = t.down;
  } else if (status?.connection === 'CONNECTED') {
    label = 'Live';
    color = t.up;
  } else if (status?.connection === 'RECOVERING') {
    label = 'Recovering';
  } else if (status?.connection === 'UNAVAILABLE' || status?.connection === 'DISCONNECTED') {
    label = 'Feed unavailable';
    color = t.down;
  }
  return (
    <View style={[styles.wrap, { borderColor: color }]} accessibilityLabel={`Market connection: ${label}`}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export function FeedWarning() {
  const t = useTheme();
  const { socketConnected, status } = useMarket();
  if (socketConnected && (status?.connection === 'CONNECTED' || !status)) return null;
  const msg = !socketConnected
    ? 'Cannot reach the server. Prices shown may be out of date. Your alarms keep running on the server.'
    : status?.connection === 'RECOVERING'
      ? 'Reconnected to the exchange; replaying missed trades so no alarm is skipped.'
      : 'The exchange feed is unavailable. Prices are marked stale and will resume automatically. No prices are invented.';
  return (
    <View style={[styles.banner, { backgroundColor: t.warnBg, borderColor: t.warn }]}>
      <Text style={{ color: t.text, fontSize: 13 }}>{msg}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: { borderWidth: 1, borderRadius: 12, padding: 12 },
});
