import type { AuthUser } from '../users/users.service.js';

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: AuthUser;
  }
}

export {};
