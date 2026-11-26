import { Module } from '@nestjs/common';
import { AlertEngineService } from '../alerts/alert-engine.service.js';
import { MarketIngestionService } from './market-ingestion.service.js';
import { MarketStateService } from './market-state.service.js';
import { BinanceProvider } from './providers/binance.provider.js';
import { BinanceRestClient } from './providers/binance-rest.client.js';
import { MARKET_PROVIDER, MARKET_REST_CLIENT } from './providers/market-provider.interface.js';

/** Runs in the market worker process: exchange connection + alert engine. */
@Module({
  providers: [
    BinanceProvider,
    BinanceRestClient,
    { provide: MARKET_PROVIDER, useExisting: BinanceProvider },
    { provide: MARKET_REST_CLIENT, useExisting: BinanceRestClient },
    MarketStateService,
    AlertEngineService,
    MarketIngestionService,
  ],
})
export class MarketIngestionModule {}
