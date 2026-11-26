import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { DevicesService } from './devices.service.js';
import { RegisterDeviceDto } from './dto/device.dto.js';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register push token' })
  register(@CurrentUser('id') userId: string, @Body() dto: RegisterDeviceDto) {
    return this.devices.register(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Registered devices' })
  list(@CurrentUser('id') userId: string) {
    return this.devices.list(userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove device' })
  async remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.devices.remove(userId, id);
  }
}
