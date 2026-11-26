import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { NotificationsQueryDto, NotificationsApiService } from './notifications-api.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsApiService) {}

  @Get()
  @ApiOperation({ summary: 'Notification history' })
  list(@CurrentUser('id') userId: string, @Query() q: NotificationsQueryDto) {
    return this.notifications.list(userId, q);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark read' })
  read(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(userId, id);
  }

  @Post('test')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a test push to your registered devices' })
  test(@CurrentUser('id') userId: string) {
    return this.notifications.sendTest(userId);
  }
}
