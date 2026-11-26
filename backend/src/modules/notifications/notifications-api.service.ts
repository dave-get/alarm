import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';
import { Queue } from 'bullmq';
import { PaginationQueryDto, pageArgs } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../database/prisma.service.js';
import { NOTIFICATIONS_QUEUE, NotificationJobs } from '../redis/redis.constants.js';

export class NotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only unread notifications' })
  @ValidateIf((_, v) => v !== undefined)
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unread?: boolean;
}

/** History, read state and test pushes (API process). */
@Injectable()
export class NotificationsApiService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async list(userId: string, q: NotificationsQueryDto) {
    const { page, pageSize, skip, take } = pageArgs(q);
    const where = { userId, ...(q.unread && { readAt: null }) };
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { deliveries: { select: { deviceId: true, status: true, error: true, sentAt: true } } },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        alertEventId: n.alertEventId,
        readAt: n.readAt,
        createdAt: n.createdAt,
        deliveries: n.deliveries,
      })),
      page,
      pageSize,
      total,
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (res.count === 0) {
      const exists = await this.prisma.notification.findFirst({ where: { id, userId }, select: { id: true, readAt: true } });
      if (!exists) throw new NotFoundException('Notification not found');
      return exists;
    }
    return this.prisma.notification.findUniqueOrThrow({ where: { id }, select: { id: true, readAt: true } });
  }

  async sendTest(userId: string) {
    const devices = await this.prisma.device.count({ where: { userId, isActive: true } });
    if (!devices) throw new BadRequestException('No active device registered. Enable notifications in the app first.');
    const n = await this.prisma.notification.create({
      data: {
        userId,
        type: 'TEST',
        title: 'Test notification',
        body: 'Push notifications are working for your price alerts.',
        data: { type: 'TEST' },
      },
    });
    await this.queue.add(NotificationJobs.sendNotification, { notificationId: n.id }, { jobId: `test-${n.id}` });
    return { notificationId: n.id, devices, queued: true };
  }
}
