import { setDefaultResultOrder } from 'node:dns';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { createLogger } from './common/logger.js';
import type { AppRole } from './config/roles.js';

export const API_PREFIX = 'api/v1';

export async function bootstrap(roles: AppRole[]) {
  // Hosts that publish AAAA records without a working IPv6 route make Binance REST (backfill) time out.
  setDefaultResultOrder((process.env.DNS_RESULT_ORDER as 'ipv4first' | 'verbatim' | undefined) ?? 'ipv4first');
  const logger = createLogger();

  if (!roles.includes('api')) {
    // Worker process: no HTTP server.
    const app = await NestFactory.createApplicationContext(AppModule.forRoles(roles), { logger });
    app.enableShutdownHooks();
    await app.init();
    new Logger('Bootstrap').log(`Worker started with roles: ${roles.join(', ')}`);
    return app;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoles(roles), { logger });
  app.enableShutdownHooks();
  // Behind Nginx (plan §14): trust one proxy hop so rate limits see the client IP.
  if (!isOff(process.env.TRUST_PROXY)) app.set('trust proxy', 1);

  app.setGlobalPrefix(API_PREFIX, { exclude: ['health', 'ready', 'health/details'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false });

  if (!isOff(process.env.SWAGGER_ENABLED)) {
    const config = new DocumentBuilder()
      .setTitle('Crypto Price Alert API')
      .setDescription('BTC, ETH, BNB, XRP and SOL (USDT) price alarms with push notifications. Real-time events: Socket.IO (see README).')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () => {
      const document = SwaggerModule.createDocument(app, config);
      document.paths['/api/docs-json'] = {
        get: { summary: 'This OpenAPI document', tags: ['docs'], responses: { '200': { description: 'The document' } } },
      };
      return document;
    });
  }

  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${port} (roles: ${roles.join(', ')}); docs at /api/docs`);
  return app;
}

function isOff(value: string | undefined) {
  return ['false', '0', 'no'].includes((value ?? '').toLowerCase());
}
