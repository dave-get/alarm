import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { AlertsService } from './alerts.service.js';
import { CreateAlertDto, HistoryQueryDto, ListAlertsQueryDto, UpdateAlertDto } from './dto/alert.dto.js';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create alarm' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateAlertDto) {
    return this.alerts.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'User alarms (cancelled excluded unless status=CANCELLED)' })
  list(@CurrentUser('id') userId: string, @Query() q: ListAlertsQueryDto) {
    return this.alerts.list(userId, q);
  }

  @Get('history')
  @ApiOperation({ summary: 'Trigger history' })
  history(@CurrentUser('id') userId: string, @Query() q: HistoryQueryDto) {
    return this.alerts.history(userId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Alarm details' })
  get(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.get(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update alarm' })
  update(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAlertDto) {
    return this.alerts.update(userId, id, dto);
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause' })
  pause(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.pause(userId, id);
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a paused alarm or re-arm a triggered one' })
  resume(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.resume(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel' })
  cancel(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.cancel(userId, id);
  }
}
