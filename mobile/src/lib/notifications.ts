import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { api } from './api';
import { EAS_PROJECT_ID } from './config';
import { StorageKeys, deleteItem, getItem, setItem } from './secure-storage';

export const ALERT_CHANNEL_ID = 'price-alerts';

/** Foreground presentation: show banner, list entry and play sound for price alerts. */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/** Android 8+: alerts need a high-importance channel with sound (server sends channelId 'price-alerts'). */
export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
    name: 'Price alerts',
    description: 'Alarms when a coin reaches your target price',
    importance: AndroidImportance.MAX,
    // No `sound` key = the system default notification sound. A string here is a custom sound file name
    // bundled via the expo-notifications plugin; 'default' is not a keyword and crashes channel creation.
    enableVibrate: true,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: '#F0B90B',
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  });
}

export type PushSetupResult =
  | { ok: true; deviceId: string }
  | { ok: false; reason: 'NOT_A_DEVICE' | 'PERMISSION_DENIED' | 'NO_PROJECT_ID' | 'ERROR'; message: string };

export async function getPermissionStatus() {
  const p = await Notifications.getPermissionsAsync();
  return { granted: p.granted, canAskAgain: p.canAskAgain, status: p.status };
}

/**
 * Plan §9: request permissions, configure the channel, get the Expo push token and
 * register it with the backend. Push works while the app is closed, subject to OS rules.
 */
export async function registerForPushNotifications(): Promise<PushSetupResult> {
  try {
    await ensureAndroidChannel();
    if (!Device.isDevice) {
      return { ok: false, reason: 'NOT_A_DEVICE', message: 'Push notifications need a physical device (not a simulator or web).' };
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: true },
      });
    }
    if (!perm.granted) {
      return { ok: false, reason: 'PERMISSION_DENIED', message: 'Notifications are turned off. Enable them in system settings.' };
    }
    if (!EAS_PROJECT_ID) {
      return { ok: false, reason: 'NO_PROJECT_ID', message: 'Missing EAS project ID (app.json extra.eas.projectId). Run `npx eas-cli init`.' };
    }
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    const device = await api<{ id: string }>('/devices', {
      method: 'POST',
      body: { pushToken, platform: Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB' },
    });
    await setItem(StorageKeys.deviceId, device.id);
    await setItem(StorageKeys.pushToken, pushToken);
    return { ok: true, deviceId: device.id };
  } catch (e) {
    return { ok: false, reason: 'ERROR', message: e instanceof Error ? e.message : String(e) };
  }
}

/** On sign-out: stop pushes to this device for the old account. */
export async function unregisterDevice() {
  const id = await getItem(StorageKeys.deviceId);
  if (id) await api(`/devices/${id}`, { method: 'DELETE' }).catch(() => undefined);
  await deleteItem(StorageKeys.deviceId);
}

export async function getRegisteredDeviceId() {
  return getItem(StorageKeys.deviceId);
}
