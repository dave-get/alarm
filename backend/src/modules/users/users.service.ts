import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface AuthUser {
  id: string;
  email: string;
  createdAt: Date;
}

const publicFields = { id: true, email: true, createdAt: true } as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: publicFields });
  }

  /** The only read that returns the hash; it never leaves the auth flow. */
  async findCredentials(email: string): Promise<{ user: AuthUser; passwordHash: string } | null> {
    const row = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!row) return null;
    return { user: { id: row.id, email: row.email, createdAt: row.createdAt }, passwordHash: row.passwordHash };
  }

  async create(email: string, passwordHash: string): Promise<AuthUser> {
    try {
      return await this.prisma.user.create({ data: { email: email.toLowerCase(), passwordHash }, select: publicFields });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw e;
    }
  }

  async updatePasswordHash(id: string, passwordHash: string) {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }
}
