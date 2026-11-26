import { Module } from '@nestjs/common';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationsProcessor } from './notifications.processor.js';
import { NotificationsService } from './notifications.service.js';
import { QueueModule } from './queue.module.js';

/** Notification worker process: BullMQ consumer, Expo push, receipts. */
@Module({
  imports: [QueueModule],
  providers: [NotificationsService, NotificationDeliveryService, NotificationsProcessor],
})
export class NotificationsWorkerModule {}
