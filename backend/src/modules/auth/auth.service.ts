import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PasswordHasher, RefreshTokenError, TokenService } from '@nestjs/authentication';
import { UsersService, type AuthUser } from '../users/users.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async register(email: string, password: string) {
    const user = await this.users.create(email, await this.hasher.hash(password));
    this.logger.log('User registered', { userId: user.id });
    return this.session(user);
  }

  async login(email: string, password: string) {
    const found = await this.users.findCredentials(email);
    // verify() checks a dummy hash when there is no user: timing doesn't reveal which emails exist.
    const valid = await this.hasher.verify(password, found?.passwordHash);
    if (!valid || !found) throw new UnauthorizedException('Invalid email or password');
    if (this.hasher.needsRehash(found.passwordHash)) {
      await this.users.updatePasswordHash(found.user.id, await this.hasher.hash(password));
    }
    return this.session(found.user);
  }

  async refresh(refreshToken: string) {
    try {
      return await this.tokens.refresh(refreshToken);
    } catch (e) {
      if (e instanceof RefreshTokenError) throw new UnauthorizedException('Invalid or expired refresh token');
      throw e;
    }
  }

  async logout(refreshToken: string) {
    await this.tokens.revoke(refreshToken);
  }

  private async session(user: AuthUser) {
    const tokens = await this.tokens.issue(user.id, { method: 'password' });
    return { user: { id: user.id, email: user.email, createdAt: user.createdAt }, tokens };
  }
}
