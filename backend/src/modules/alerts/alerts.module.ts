import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

/** API side of alarms. The evaluating AlertEngineService runs in the market worker (MarketIngestionModule). */
@Module({
  imports: [MarketDataModule],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
