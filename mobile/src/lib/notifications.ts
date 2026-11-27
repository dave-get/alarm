import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidAudioContentType, AndroidAudioUsage, AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { api } from './api';
import { EAS_PROJECT_ID } from './config';
import { StorageKeys, deleteItem, getItem, setItem } from './secure-storage';

/** General notifications (test pushes). */
export const ALERT_CHANNEL_ID = 'price-alerts';
/**
 * Price alarms: the bundled 30 s alarm tone on the ALARM audio stream, so it rings at alarm
 * volume and still sounds when the phone is on silent/vibrate. Android fixes a channel's sound
 * when it is first created, so this is a new channel id; the server sends alarms on it.
 */
export const ALARM_CHANNEL_ID = 'price-alarms';
export const ALARM_SOUND = 'alarm.wav';

/** Alert events already shown on this device, so the socket event and the push don't both ring. */
const shownAlertEvents = new Set<string>();
const LOCAL_ALERT_PREFIX = 'alert-';

/** Foreground presentation: show banner, list entry and play sound for price alerts. */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const { identifier, content } = notification.request;
      const alertEventId = (content.data as { alertEventId?: unknown } | undefined)?.alertEventId;
      const isLocal = identifier.startsWith(LOCAL_ALERT_PREFIX);
      // A push for an alarm the app already rang for (via the live connection): stay silent.
      const duplicate = !isLocal && typeof alertEventId === 'string' && shownAlertEvents.has(alertEventId);
      if (typeof alertEventId === 'string') shownAlertEvents.add(alertEventId);
      return {
        shouldShowBanner: !duplicate,
        shouldShowList: !duplicate,
        shouldPlaySound: !duplicate,
        shouldSetBadge: !duplicate,
      };
    },
  });
}

/**
 * Rings for an alarm that arrived over the live connection while the app is running.
 * A local notification on the 'price-alarms' channel plays the alarm tone and needs no
 * push setup. Alarms while the app is closed arrive by push on the same channel.
 */
export async function presentAlarmNotification(alarm: {
  alertEventId: string;
  alertId: string;
  symbol: string;
  triggeredPrice: string;
  targetPrice: string;
  title: string;
  body: string;
}) {
  if (Platform.OS === 'web' || shownAlertEvents.has(alarm.alertEventId)) return;
  shownAlertEvents.add(alarm.alertEventId);
  await Notifications.scheduleNotificationAsync({
    identifier: `${LOCAL_ALERT_PREFIX}${alarm.alertEventId}`,
    content: {
      title: alarm.title,
      body: alarm.body,
      sound: ALARM_SOUND, // iOS; Android takes the sound from the channel
      priority: Notifications.AndroidNotificationPriority.MAX,
      sticky: false,
      data: {
        type: 'PRICE_ALERT',
        alertId: alarm.alertId,
        alertEventId: alarm.alertEventId,
        symbol: alarm.symbol,
        price: alarm.triggeredPrice,
      },
    },
    trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
  });
}

/** Ask for notification permission (Android 13+ / iOS) without needing push setup. */
export async function ensureNotificationPermission() {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) return current.granted;
  const next = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
  return next.granted;
}

/** Android 8+: creates the alarm channel (alarm tone, alarm volume) and the general channel. */
export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: 'Price alarms',
    description: 'Rings with an alarm tone when a coin reaches your target price',
    importance: AndroidImportance.MAX,
    sound: ALARM_SOUND, // bundled by the expo-notifications plugin (app.json "sounds")
    audioAttributes: {
      usage: AndroidAudioUsage.ALARM,
      contentType: AndroidAudioContentType.SONIFICATION,
      flags: { enforceAudibility: true, requestHardwareAudioVideoSynchronization: false },
    },
    enableVibrate: true,
    vibrationPattern: [0, 800, 400, 800, 400, 800, 400, 800],
    lightColor: '#F0B90B',
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  });
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
    name: 'General',
    description: 'Test notifications and other messages',
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
