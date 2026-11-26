import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import type { AppConfig } from '../../../config/configuration.js';
import { parseAggTradeMessage } from './binance-event.schema.js';
import {
  SUPPORTED_SYMBOLS,
  type MarketPrice,
  type MarketProvider,
  type ProviderConnectionState,
} from './market-provider.interface.js';

/**
 * One shared Binance combined-stream connection for all users (plan §2, §5).
 *
 * Beyond the starter in the plan:
 * - schema validation of every frame;
 * - heartbeat watchdog: any frame/ping/pong resets it; silence => terminate and reconnect;
 *   we also ping the server so a quiet but dead TCP connection is noticed;
 * - planned rotation before Binance's 24h connection lifetime, overlapping the
 *   new socket with the old one (duplicates are removed downstream by trade ID);
 * - reconnect with exponential backoff and jitter;
 * - graceful shutdown.
 */
@Injectable()
export class BinanceProvider implements MarketProvider, OnModuleDestroy {
  private readonly logger = new Logger(BinanceProvider.name);
  private socket?: WebSocket;
  private rotating?: WebSocket;
  private stopping = false;
  private attempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private rotateTimer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private lastFrameAt = 0;
  private invalidFrames = 0;
  private handler: (price: MarketPrice) => void = () => {};
  private stateHandler: (state: ProviderConnectionState) => void = () => {};

  private readonly wsBase: string;
  private readonly heartbeatTimeout: number;
  private readonly rotateAfter: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.wsBase = config.get('BINANCE_WS_URL', { infer: true }).replace(/\/$/, '');
    this.heartbeatTimeout = config.get('MARKET_HEARTBEAT_TIMEOUT_MS', { infer: true });
    this.rotateAfter = config.get('MARKET_ROTATE_AFTER_MS', { infer: true });
  }

  onPrice(handler: (price: MarketPrice) => void) {
    this.handler = handler;
  }

  onConnectionChange(handler: (state: ProviderConnectionState) => void) {
    this.stateHandler = handler;
  }

  get url() {
    const streams = SUPPORTED_SYMBOLS.map((s) => `${s.toLowerCase()}@aggTrade`).join('/');
    return `${this.wsBase}/stream?streams=${streams}`;
  }

  connect() {
    this.stopping = false;
    if (this.socket) return;
    this.stateHandler('CONNECTING');
    this.socket = this.open(false);
  }

  private open(isRotation: boolean): WebSocket {
    const socket = new WebSocket(this.url, { handshakeTimeout: 10_000 });

    socket.on('open', () => {
      this.lastFrameAt = Date.now();
      if (isRotation) {
        // Swap: the new socket is current, the old one closes without triggering a reconnect.
        const old = this.socket;
        this.socket = socket;
        this.rotating = undefined;
        if (old) {
          old.removeAllListeners('close');
          old.on('close', () => undefined);
          old.close(1000, 'rotation');
          setTimeout(() => old.terminate(), 5_000).unref();
        }
        this.logger.log('Binance connection rotated');
      } else {
        this.attempts = 0;
        this.logger.log('Binance connected');
        this.stateHandler('CONNECTED');
      }
      this.scheduleRotation();
      this.startWatchdog();
    });

    socket.on('message', (raw: WebSocket.RawData) => {
      this.lastFrameAt = Date.now();
      const result = parseAggTradeMessage(raw.toString());
      if (result.ok) {
        try {
          this.handler(result.price);
        } catch (e) {
          this.logger.error(`Price handler failed: ${(e as Error).message}`);
        }
      } else if (result.reason === 'invalid' && ++this.invalidFrames % 100 === 1) {
        this.logger.warn(`Invalid market event (${this.invalidFrames} so far)`);
      }
    });

    // ws answers server pings with pongs automatically; both count as liveness.
    socket.on('ping', () => (this.lastFrameAt = Date.now()));
    socket.on('pong', () => (this.lastFrameAt = Date.now()));

    socket.on('error', (error: Error) => {
      this.logger.error(`Binance socket error: ${error.message}`);
      socket.terminate();
    });

    socket.on('close', (code: number) => {
      if (isRotation && this.rotating === socket) {
        // Replacement failed before opening; keep the current connection and try again later.
        this.rotating = undefined;
        this.rotateTimer = setTimeout(() => this.rotate(), 60_000);
        return;
      }
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.stopTimers();
      this.stateHandler('DISCONNECTED');
      if (!this.stopping) {
        const delay = Math.min(1000 * 2 ** this.attempts++, 30_000) + Math.random() * 1000;
        this.logger.warn(`Binance disconnected (code ${code}); reconnecting in ${Math.round(delay)} ms`);
        this.reconnectTimer = setTimeout(() => {
          this.stateHandler('CONNECTING');
          this.socket = this.open(false);
        }, delay);
      }
    });

    return socket;
  }

  private scheduleRotation() {
    clearTimeout(this.rotateTimer);
    this.rotateTimer = setTimeout(() => this.rotate(), this.rotateAfter);
  }

  private rotate() {
    if (this.stopping || !this.socket || this.rotating) return;
    this.logger.log('Rotating Binance connection before its 24h lifetime expires');
    this.rotating = this.open(true);
  }

  private startWatchdog() {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const silentFor = Date.now() - this.lastFrameAt;
      if (silentFor > this.heartbeatTimeout) {
        this.logger.warn(`No frames for ${silentFor} ms; terminating connection`);
        socket.terminate();
        return;
      }
      if (silentFor > this.heartbeatTimeout / 3) socket.ping();
    }, Math.max(1000, Math.floor(this.heartbeatTimeout / 6)));
  }

  private stopTimers() {
    clearInterval(this.watchdogTimer);
    clearTimeout(this.rotateTimer);
  }

  disconnect() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    this.stopTimers();
    for (const s of [this.socket, this.rotating]) {
      if (!s) continue;
      s.removeAllListeners('close');
      s.on('close', () => undefined);
      s.terminate();
    }
    this.socket = undefined;
    this.rotating = undefined;
    this.stateHandler('DISCONNECTED');
  }

  onModuleDestroy() {
    this.disconnect();
  }
}
