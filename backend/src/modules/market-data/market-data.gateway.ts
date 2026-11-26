import { Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtVerifier, Public } from '@nestjs/authentication';
import { SkipThrottle } from '@nestjs/throttler';
import type { Server, Socket } from 'socket.io';
import type { AppConfig } from '../../config/configuration.js';
import { SUPPORTED_SYMBOLS, isSupportedSymbol } from '../../common/enums/symbols.enum.js';
import { RedisChannels } from '../redis/redis.constants.js';
import { RedisPubSubService } from '../redis/redis-pubsub.service.js';
import { UsersService } from '../users/users.service.js';
import type { CachedPrice, MarketStatus } from './interfaces/market.interfaces.js';
import { MarketDataService } from './market-data.service.js';

interface SocketData {
  userId?: string;
  authExp?: number;
}

const corsOrigins = () => {
  const list = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : false;
};

/**
 * Plan §11. The mobile app connects here, never to Binance.
 *  client -> server: market:subscribe, market:unsubscribe
 *  server -> client: market:price (throttled, 500–1000 ms), market:status, alert:triggered (owner room only)
 */
@Public() // public price feed; private rooms are authorized in handleConnection
@SkipThrottle()
@WebSocketGateway({ cors: { origin: corsOrigins() }, transports: ['websocket', 'polling'] })
export class MarketDataGateway implements OnGatewayConnection, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MarketDataGateway.name);
  @WebSocketServer() server!: Server;

  private readonly pending = new Map<string, CachedPrice & { isStale?: boolean }>();
  private status: MarketStatus | null = null;
  private timers: NodeJS.Timeout[] = [];
  private verifier: JwtVerifier;

  constructor(
    private readonly market: MarketDataService,
    private readonly pubsub: RedisPubSubService,
    private readonly users: UsersService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.verifier = new JwtVerifier({
      key: config.get('JWT_SECRET', { infer: true }),
      algorithms: ['HS256'],
      issuer: config.get('JWT_ISSUER', { infer: true }),
      audience: config.get('JWT_AUDIENCE', { infer: true }),
    });
  }

  async onModuleInit() {
    await this.pubsub.subscribe(RedisChannels.prices, (msg) => {
      for (const p of msg as (CachedPrice & { isStale?: boolean })[]) this.pending.set(p.symbol, p);
    });
    await this.pubsub.subscribe(RedisChannels.status, (msg) => this.emitStatus(msg as MarketStatus));
    await this.pubsub.subscribe(RedisChannels.alertTriggered, (msg) => {
      const m = msg as { userId?: string; payload?: unknown };
      if (m.userId) this.server.to(`user:${m.userId}`).emit('alert:triggered', m.payload);
    });

    const interval = this.config.get('UI_BROADCAST_INTERVAL_MS', { infer: true });
    this.timers.push(
      // Throttle only UI broadcasts (plan §8): latest price per symbol per interval.
      setInterval(() => this.broadcastPrices(), interval),
      // Detect a dead market worker (no status heartbeat) and expire socket auth.
      setInterval(() => void this.housekeeping(), 5_000),
    );
  }

  onApplicationShutdown() {
    this.timers.forEach((t) => clearInterval(t));
  }

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (token) {
      try {
        const claims = await this.verifier.verify(token);
        const user = claims.sub ? await this.users.findById(claims.sub) : null;
        if (user) {
          const data = client.data as SocketData;
          data.userId = user.id;
          data.authExp = typeof claims.exp === 'number' ? claims.exp * 1000 : undefined;
          await client.join(`user:${user.id}`);
          client.emit('auth:ok', { userId: user.id });
        } else {
          client.emit('auth:error', { message: 'Unknown user' });
        }
      } catch {
        client.emit('auth:error', { message: 'Invalid or expired token' });
      }
    }
    // Fresh snapshot on (re)connect.
    client.emit('market:status', this.publicStatus(this.status ?? (await this.market.getStatus())));
  }

  @SubscribeMessage('market:subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { symbols?: unknown } | undefined) {
    const symbols = this.parseSymbols(body?.symbols);
    await client.join(symbols.map((s) => `symbol:${s}`));
    // Snapshot for the newly subscribed symbols.
    const prices = await this.market.getPrices();
    for (const p of prices) if (symbols.includes(p.symbol as never)) client.emit('market:price', this.priceEvent(p));
    return { subscribed: symbols };
  }

  @SubscribeMessage('market:unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { symbols?: unknown } | undefined) {
    const symbols = this.parseSymbols(body?.symbols);
    for (const s of symbols) await client.leave(`symbol:${s}`);
    return { unsubscribed: symbols };
  }

  private broadcastPrices() {
    if (!this.pending.size || !this.server) return;
    for (const p of this.pending.values()) {
      const isStale = p.isStale ?? (this.status ? this.market.isStale(p.symbol, this.status) : true);
      this.server.to(`symbol:${p.symbol}`).emit('market:price', {
        symbol: p.symbol,
        price: p.price,
        source: p.source,
        timestamp: p.timestamp,
        isStale,
      });
    }
    this.pending.clear();
  }

  private emitStatus(status: MarketStatus) {
    const changed = !this.status || this.status.connection !== status.connection || JSON.stringify(this.status.symbols) !== JSON.stringify(status.symbols);
    this.status = status;
    if (changed && this.server) this.server.emit('market:status', this.publicStatus(status));
  }

  private async housekeeping() {
    try {
      const status = await this.market.getStatus();
      if (status.connection === 'UNAVAILABLE' && this.status?.connection !== 'UNAVAILABLE') this.emitStatus(status);
      else if (!this.status) this.status = status;
    } catch {
      /* Redis down: health endpoint reports it */
    }
    // An open socket keeps its user after the access token expires: drop it from the private room.
    const now = Date.now();
    for (const socket of await this.server.fetchSockets()) {
      const data = socket.data as SocketData;
      if (data.userId && data.authExp && data.authExp < now) {
        socket.leave(`user:${data.userId}`);
        socket.emit('auth:expired', {});
        data.userId = undefined;
      }
    }
  }

  private publicStatus(s: MarketStatus) {
    return { connection: s.connection, source: s.source, updatedAt: s.updatedAt, symbols: s.symbols };
  }

  private priceEvent(p: { symbol: string; price: string | null; source: string; timestamp: number | null; isStale: boolean }) {
    return { symbol: p.symbol, price: p.price, source: p.source, timestamp: p.timestamp, isStale: p.isStale };
  }

  private parseSymbols(input: unknown) {
    if (!Array.isArray(input) || input.length === 0) return [...SUPPORTED_SYMBOLS];
    return input.map((s) => String(s).toUpperCase()).filter(isSupportedSymbol);
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    if (typeof auth?.token === 'string' && auth.token) return auth.token.replace(/^Bearer\s+/i, '');
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
