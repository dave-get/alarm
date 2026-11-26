import { Injectable } from '@nestjs/common';
import { AuthenticationRegistry, JwtBearerProvider, type JwtClaims } from '@nestjs/authentication';
import { UsersService, type AuthUser } from '../users/users.service.js';

/** Bearer access tokens. The user is reloaded on every request, so a deleted user loses access at once. */
@Injectable()
export class JwtAuth extends JwtBearerProvider<AuthUser> {
  constructor(
    private readonly users: UsersService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this, { order: 1 });
  }

  protected validate({ sub }: JwtClaims) {
    return sub ? this.users.findById(sub) : null;
  }
}
