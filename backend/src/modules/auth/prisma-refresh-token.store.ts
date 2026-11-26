import { Injectable } from '@nestjs/common';
import { AuthenticationStorage, type RefreshTokenRecord, type RefreshTokenStore } from '@nestjs/authentication';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Refresh tokens in PostgreSQL (rotation + reuse detection by TokenService).
 * Tokens are stored by SHA-256 only.
 */
@Injectable()
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(
    private readonly prisma: PrismaService,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ refreshTokens: this });
  }

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!row) return undefined;
    return {
      id: row.id,
      familyId: row.familyId,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      familyExpiresAt: row.familyExpiresAt,
      usedAt: row.usedAt ?? undefined,
      claims: (row.claims as Record<string, unknown> | null) ?? undefined,
    };
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { familyExpiresAt: { lt: new Date() } } });
    await this.prisma.refreshToken.create({
      data: {
        id: record.id,
        familyId: record.familyId,
        userId: record.userId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        familyExpiresAt: record.familyExpiresAt,
        usedAt: record.usedAt ?? null,
        claims: (record.claims as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      },
    });
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    const res = await this.prisma.refreshToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } });
    return res.count === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    const token = await this.prisma.refreshToken.findFirst({ where: { familyId }, select: { userId: true } });
    if (!token) return;
    await this.prisma.refreshTokenFamily.upsert({
      where: { id: familyId },
      create: { id: familyId, userId: token.userId },
      update: {},
    });
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    return (await this.prisma.refreshTokenFamily.count({ where: { id: familyId } })) > 0;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    const families = await this.prisma.refreshToken.findMany({ where: { userId }, distinct: ['familyId'], select: { familyId: true } });
    if (!families.length) return;
    await this.prisma.refreshTokenFamily.createMany({
      data: families.map((f) => ({ id: f.familyId, userId })),
      skipDuplicates: true,
    });
  }
}
