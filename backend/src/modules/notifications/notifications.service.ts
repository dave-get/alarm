import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Expo, type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import type { AppConfig } from '../../config/configuration.js';

export const ANDROID_CHANNEL_ID = 'price-alerts';

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
      sound: 'default',
      priority: 'high',
      title: `${symbol} Price Alert`,
      body: `${symbol} reached ${price} USDT. Target: ${target}`,
      channelId: ANDROID_CHANNEL_ID,
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
