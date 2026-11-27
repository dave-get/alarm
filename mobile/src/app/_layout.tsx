import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { AlertBanner } from '../components/AlertBanner';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { MarketProvider } from '../context/MarketContext';
import { configureNotificationHandler, ensureAndroidChannel, ensureNotificationPermission, registerForPushNotifications } from '../lib/notifications';
import { useTheme } from '../lib/theme';

configureNotificationHandler();

/** Opens the alarm a tapped notification refers to, also on cold start. */
function NotificationBridge() {
  const { status } = useAuth();
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    ensureAndroidChannel().catch((e) => console.warn('Could not create the price-alerts notification channel', e));
  }, []);

  // Ask for notification permission once (needed for the alarm sound), then keep this
  // device's push token registered. Push registration needs Firebase on Android.
  useEffect(() => {
    if (status !== 'signedIn' || Platform.OS === 'web') return;
    void ensureNotificationPermission()
      .then((granted) => (granted ? registerForPushNotifications() : undefined))
      .then((res) => {
        if (res && !res.ok) console.warn(`Push registration failed (${res.reason}): ${res.message}`);
      })
      .catch((e) => console.warn('Notification setup failed', e));
  }, [status]);

  useEffect(() => {
    if (status !== 'signedIn' || !lastResponse) return;
    const data = lastResponse.notification.request.content.data as { type?: string; alertId?: string } | undefined;
    if (data?.type === 'PRICE_ALERT' && data.alertId) router.push(`/alarm/${data.alertId}`);
    else router.push('/history');
  }, [lastResponse, status]);

  return null;
}

function RootStack() {
  const t = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="alarm/new" options={{ presentation: 'modal', title: 'New alarm' }} />
        <Stack.Screen name="alarm/[id]" options={{ title: 'Alarm' }} />
      </Stack>
      <AlertBanner />
      <NotificationBridge />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <MarketProvider>
          <RootStack />
        </MarketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
