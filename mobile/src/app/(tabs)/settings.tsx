import { useCallback, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button, Card, SectionTitle } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { API_URL } from '../../lib/config';
import { getPermissionStatus, getRegisteredDeviceId, registerForPushNotifications } from '../../lib/notifications';
import { useTheme } from '../../lib/theme';

/** Notification settings, permissions, test push, account (plan §9, §15 Phase 5 "Sound and permissions"). */
export default function SettingsScreen() {
  const t = useTheme();
  const { user, signOut } = useAuth();
  const [permission, setPermission] = useState<string>('unknown');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'enable' | 'test' | null>(null);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'web') setPermission((await getPermissionStatus()).status);
    setDeviceId(await getRegisteredDeviceId());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const enable = async () => {
    setBusy('enable');
    const res = await registerForPushNotifications();
    setBusy(null);
    await refresh();
    if (res.ok) Alert.alert('Notifications enabled', 'This device will receive price alerts, even when the app is closed.');
    else if (res.reason === 'PERMISSION_DENIED')
      Alert.alert('Notifications are off', res.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ]);
    else Alert.alert('Could not enable notifications', res.message);
  };

  const test = async () => {
    setBusy('test');
    try {
      await api('/notifications/test', { method: 'POST' });
      Alert.alert('Test sent', 'You should receive a push notification within a few seconds.');
    } catch (e) {
      Alert.alert('Test failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const granted = permission === 'granted';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionTitle>Notifications</SectionTitle>
      <Card style={{ gap: 12 }}>
        <Row label="Permission" value={Platform.OS === 'web' ? 'not supported on web' : permission} ok={granted} />
        <Row label="This device" value={deviceId ? 'registered for push' : 'not registered'} ok={!!deviceId} />
        <Button title={deviceId && granted ? 'Re-register device' : 'Enable notifications'} onPress={enable} loading={busy === 'enable'} />
        <Button title="Send test notification" variant="secondary" onPress={test} loading={busy === 'test'} disabled={!deviceId} />
        {Platform.OS === 'android' ? (
          <Button title="Sound & channel settings" variant="secondary" onPress={() => void Linking.openSettings()} />
        ) : null}
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 18 }}>
          Alarms are checked on the server, so they work while the app is closed. Delivery, sound and timing still depend on the
          operating system: silent mode, Focus / Do Not Disturb and battery savers can delay or mute alerts. A push notification
          is not a guaranteed wake-up alarm.
        </Text>
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card style={{ gap: 12 }}>
        <Row label="Signed in as" value={user?.email ?? '—'} />
        <Row label="Server" value={API_URL} />
        <Button
          title="Sign out"
          variant="danger"
          onPress={() =>
            Alert.alert('Sign out?', 'This device stops receiving alerts for this account.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
            ])
          }
        />
      </Card>
      <Text style={{ color: t.muted, fontSize: 12, textAlign: 'center' }}>
        Market data: Binance spot (public). No wallet access or trading permissions are used.
      </Text>
    </ScrollView>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: t.muted }}>{label}</Text>
      <Text style={{ color: ok === undefined ? t.text : ok ? t.up : t.warn, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
});
