import { Module } from '@nestjs/common';
import { NotificationsApiService } from './notifications-api.service.js';
import { NotificationsController } from './notifications.controller.js';
import { QueueModule } from './queue.module.js';

/** API side: history, mark read, test push (enqueued). */
@Module({
  imports: [QueueModule],
  controllers: [NotificationsController],
  providers: [NotificationsApiService],
})
export class NotificationsModule {}
