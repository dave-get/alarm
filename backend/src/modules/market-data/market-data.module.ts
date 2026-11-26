import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { MarketDataController } from './market-data.controller.js';
import { MarketDataGateway } from './market-data.gateway.js';
import { MarketDataService } from './market-data.service.js';

/** API side of market data: REST read endpoints and the Socket.IO gateway. */
@Module({
  imports: [UsersModule],
  controllers: [MarketDataController],
  providers: [MarketDataService, MarketDataGateway],
  exports: [MarketDataService],
})
export class MarketDataModule {}
