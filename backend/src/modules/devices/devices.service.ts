import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';
import { PrismaService } from '../database/prisma.service.js';
import type { RegisterDeviceDto } from './dto/device.dto.js';

/** Plan §4 "Devices manages tokens". */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDeviceDto) {
    if (!Expo.isExpoPushToken(dto.pushToken)) throw new BadRequestException('Invalid Expo push token');
    // A token belongs to one device; if another account signed in on it, the token moves.
    const device = await this.prisma.device.upsert({
      where: { pushToken: dto.pushToken },
      create: { userId, pushToken: dto.pushToken, platform: dto.platform },
      update: { userId, platform: dto.platform, isActive: true, disabledReason: null, lastSeenAt: new Date() },
    });
    this.logger.log('Device registered', { userId, deviceId: device.id, platform: device.platform });
    return this.serialize(device);
  }

  async list(userId: string) {
    const devices = await this.prisma.device.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
    return devices.map((d) => this.serialize(d));
  }

  async remove(userId: string, id: string) {
    const res = await this.prisma.device.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundException('Device not found');
  }

  private serialize(d: { id: string; platform: string; isActive: boolean; disabledReason: string | null; lastSeenAt: Date; createdAt: Date; pushToken: string }) {
    // Never echo the full token.
    return {
      id: d.id,
      platform: d.platform,
      isActive: d.isActive,
      disabledReason: d.disabledReason,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      tokenHint: `…${d.pushToken.slice(-6)}`,
    };
  }
}
