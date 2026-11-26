import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/configuration.js';
import type { AppRole } from './config/roles.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { RateLimitModule } from './common/guards/rate-limit.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { AlertsModule } from './modules/alerts/alerts.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MarketDataModule } from './modules/market-data/market-data.module.js';
import { MarketIngestionModule } from './modules/market-data/market-ingestion.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { NotificationsWorkerModule } from './modules/notifications/notifications-worker.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { UsersModule } from './modules/users/users.module.js';

/**
 * Modular monolith (plan §2). One codebase, composed per process role:
 *  api            HTTP REST + Socket.IO gateway
 *  market         Binance ingestion + alert engine (single leader)
 *  outbox         outbox dispatcher -> BullMQ
 *  notifications  BullMQ worker -> Expo push, receipts
 */
@Module({})
export class AppModule {
  static forRoles(roles: AppRole[]): DynamicModule {
    const imports: NonNullable<ModuleMetadata['imports']> = [
      ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
      DatabaseModule,
      RedisModule,
    ];
    const providers = [];

    if (roles.includes('api')) {
      // Order matters: authentication's global guard must run before the rate limiter.
      imports.push(AuthModule, RateLimitModule, UsersModule, MarketDataModule, AlertsModule, DevicesModule, NotificationsModule, HealthModule);
      providers.push(
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      );
    }
    if (roles.includes('market')) imports.push(MarketIngestionModule);
    if (roles.includes('outbox')) imports.push(OutboxModule);
    if (roles.includes('notifications')) imports.push(NotificationsWorkerModule);

    return { module: AppModule, imports, providers };
  }
}
