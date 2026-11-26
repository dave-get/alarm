import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '@nestjs/authentication';
import { SUPPORTED_SYMBOLS } from '../../common/enums/symbols.enum.js';
import { MarketDataService } from './market-data.service.js';

/** Plan §10 market endpoints. Public market data, no authentication. */
@ApiTags('market')
@Public()
@Controller('market')
export class MarketDataController {
  constructor(private readonly market: MarketDataService) {}

  @Get('symbols')
  @ApiOperation({ summary: 'Supported coins' })
  symbols() {
    return this.market.getSymbols();
  }

  @Get('prices')
  @ApiOperation({ summary: 'Latest price for all five symbols' })
  prices() {
    return this.market.getPrices();
  }

  @Get('prices/:symbol')
  @ApiOperation({ summary: 'Latest price for one symbol' })
  @ApiParam({ name: 'symbol', enum: SUPPORTED_SYMBOLS })
  price(@Param('symbol') symbol: string) {
    return this.market.getPrice(symbol);
  }

  @Get('status')
  @ApiOperation({ summary: 'Exchange connection status' })
  status() {
    return this.market.getStatus();
  }
}
