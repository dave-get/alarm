import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { DependencyHealthIndicators, HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule.forRoot({ gracefulShutdownTimeoutMs: 2_000 }), MarketDataModule],
  controllers: [HealthController],
  providers: [DependencyHealthIndicators],
})
export class HealthModule {}
