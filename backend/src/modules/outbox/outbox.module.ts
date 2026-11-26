import { Module } from '@nestjs/common';
import { QueueModule } from '../notifications/queue.module.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';

/** Outbox dispatcher process: committed events -> BullMQ. */
@Module({
  imports: [QueueModule],
  providers: [OutboxDispatcherService],
})
export class OutboxModule {}
