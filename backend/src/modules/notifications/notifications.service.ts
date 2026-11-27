import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import type { AppConfig } from '../../config/configuration.js';

/** General notifications (test pushes). */
export const ANDROID_CHANNEL_ID = 'price-alerts';
/**
 * Price alarms. The app creates this channel with a bundled 30 s alarm tone on the ALARM
 * audio stream (rings at alarm volume, also on silent). Android takes the sound from the channel.
 */
export const ANDROID_ALARM_CHANNEL_ID = 'price-alarms';
/** Bundled alarm tone; used as the iOS sound (Android uses the channel's sound). */
export const ALARM_SOUND = 'alarm.wav';

/** Channel and sound for a notification of the given type. */
export function pushChannelFor(type: string): { channelId: string; sound: string } {
  return type === 'PRICE_ALERT' ? { channelId: ANDROID_ALARM_CHANNEL_ID, sound: ALARM_SOUND } : { channelId: ANDROID_CHANNEL_ID, sound: 'default' };
}

/** Expo Push (plan §9): NestJS worker -> Expo Push Service -> FCM/APNs -> device. */
@Injectable()
export class NotificationsService {
  private readonly expo: Expo;

  constructor(config: ConfigService<AppConfig, true>) {
    const accessToken = config.get('EXPO_ACCESS_TOKEN', { infer: true });
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  isValidToken(token: string) {
    return Expo.isExpoPushToken(token);
  }

  buildPriceAlert(pushToken: string, symbol: string, price: string, target: string, alertId: string, extra: Record<string, unknown> = {}): ExpoPushMessage {
    return {
      to: pushToken,
      ...pushChannelFor('PRICE_ALERT'),
      priority: 'high',
      title: `${symbol} Price Alert`,
      body: `${symbol} reached ${price} USDT. Target: ${target}`,
      data: { type: 'PRICE_ALERT', alertId, symbol, price, ...extra },
    };
  }

  /** The plan's single-message helper. */
  async sendPriceAlert(pushToken: string, symbol: string, price: string, target: string, alertId: string) {
    if (!Expo.isExpoPushToken(pushToken)) throw new Error('Invalid push token');
    return this.expo.sendPushNotificationsAsync([this.buildPriceAlert(pushToken, symbol, price, target, alertId)]);
  }

  /** Sends in Expo-sized chunks; tickets are returned in message order. */
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      tickets.push(...(await this.expo.sendPushNotificationsAsync(chunk)));
    }
    return tickets;
  }

  async receipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>> {
    const out: Record<string, ExpoPushReceipt> = {};
    for (const chunk of this.expo.chunkPushNotificationReceiptIds(ids)) {
      Object.assign(out, await this.expo.getPushNotificationReceiptsAsync(chunk));
    }
    return out;
  }
}
