import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { pageArgs } from '../../common/dto/pagination.dto.js';
import { Prisma, type PriceAlert } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { RedisChannels } from '../redis/redis.constants.js';
import { RedisPubSubService } from '../redis/redis-pubsub.service.js';
import { distancePercent, shouldTrigger } from './alert-condition.js';
import { serializeAlert, serializeAlertEvent } from './alert.serializer.js';
import type { CreateAlertDto, HistoryQueryDto, ListAlertsQueryDto, UpdateAlertDto } from './dto/alert.dto.js';

/** Alarm CRUD (plan §4 "Alerts manages alarm CRUD"). Every query is scoped to the owner. */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketDataService,
    private readonly pubsub: RedisPubSubService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(userId: string, dto: CreateAlertDto) {
    const max = this.config.get('MAX_ACTIVE_ALERTS_PER_USER', { infer: true });
    const active = await this.prisma.priceAlert.count({ where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
    if (active >= max) throw new ConflictException(`You can have at most ${max} active or paused alarms`);

    const alert = await this.prisma.priceAlert.create({
      data: {
        userId,
        symbol: dto.symbol,
        targetPrice: dto.targetPrice,
        condition: dto.condition,
        mode: dto.mode ?? 'ONCE',
        ...(dto.cooldownSeconds !== undefined && { cooldownSeconds: dto.cooldownSeconds }),
        ...(dto.rearmMarginPercent !== undefined && { rearmMarginPercent: dto.rearmMarginPercent }),
      },
    });
    await this.notifyChanged(alert.id);
    this.logger.log('Alert created', { alertId: alert.id, userId, symbol: alert.symbol });
    return this.withMarket(alert);
  }

  async list(userId: string, q: ListAlertsQueryDto) {
    const alerts = await this.prisma.priceAlert.findMany({
      where: {
        userId,
        ...(q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }),
        ...(q.symbol && { symbol: q.symbol }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const prices = await this.market.getPrices().catch(() => []);
    const bySymbol = new Map(prices.map((p) => [p.symbol, p]));
    return alerts.map((a) => {
      const p = bySymbol.get(a.symbol);
      return {
        ...serializeAlert(a),
        currentPrice: p?.price ?? null,
        isStale: p?.isStale ?? true,
        distancePercent: p?.price ? distancePercent(p.price, a.targetPrice.toString()) : null,
      };
    });
  }

  async history(userId: string, q: HistoryQueryDto) {
    const { page, pageSize, skip, take } = pageArgs(q);
    const where: Prisma.AlertEventWhereInput = {
      userId,
      ...(q.symbol && { symbol: q.symbol }),
      ...(q.alertId && { alertId: q.alertId }),
    };
    const [items, total] = await Promise.all([
      this.prisma.alertEvent.findMany({ where, orderBy: { triggeredAt: 'desc' }, skip, take }),
      this.prisma.alertEvent.count({ where }),
    ]);
    return { items: items.map(serializeAlertEvent), page, pageSize, total };
  }

  async get(userId: string, id: string) {
    const alert = await this.findOwned(userId, id);
    const events = await this.prisma.alertEvent.findMany({ where: { alertId: id }, orderBy: { triggeredAt: 'desc' }, take: 20 });
    return { ...(await this.withMarket(alert)), recentEvents: events.map(serializeAlertEvent) };
  }

  async update(userId: string, id: string, dto: UpdateAlertDto) {
    if (Object.values(dto).every((v) => v === undefined)) throw new BadRequestException('Nothing to update');
    const alert = await this.findOwned(userId, id);
    if (alert.status !== 'ACTIVE' && alert.status !== 'PAUSED') {
      throw new ConflictException(`A ${alert.status.toLowerCase()} alarm cannot be edited; resume or create a new one`);
    }
    const thresholdChanged = dto.targetPrice !== undefined || dto.condition !== undefined || dto.mode !== undefined;
    const updated = await this.conditionalUpdate(id, userId, ['ACTIVE', 'PAUSED'], {
      ...(dto.targetPrice !== undefined && { targetPrice: dto.targetPrice }),
      ...(dto.condition !== undefined && { condition: dto.condition }),
      ...(dto.mode !== undefined && { mode: dto.mode }),
      ...(dto.cooldownSeconds !== undefined && { cooldownSeconds: dto.cooldownSeconds }),
      ...(dto.rearmMarginPercent !== undefined && { rearmMarginPercent: dto.rearmMarginPercent }),
      // A new threshold is a new alarm: arm it again.
      ...(thresholdChanged && { armed: true }),
    });
    await this.notifyChanged(id);
    return this.withMarket(updated);
  }

  async pause(userId: string, id: string) {
    await this.findOwned(userId, id);
    const updated = await this.conditionalUpdate(id, userId, ['ACTIVE'], { status: 'PAUSED' });
    await this.notifyChanged(id);
    return serializeAlert(updated);
  }

  /** Resume a paused alarm, or re-arm a triggered one-time alarm. */
  async resume(userId: string, id: string) {
    await this.findOwned(userId, id);
    const updated = await this.conditionalUpdate(id, userId, ['PAUSED', 'TRIGGERED'], { status: 'ACTIVE', armed: true });
    await this.notifyChanged(id);
    return this.withMarket(updated);
  }

  async cancel(userId: string, id: string) {
    await this.findOwned(userId, id);
    const updated = await this.conditionalUpdate(id, userId, ['ACTIVE', 'PAUSED', 'TRIGGERED'], { status: 'CANCELLED', armed: false });
    await this.notifyChanged(id);
    return serializeAlert(updated);
  }

  private async findOwned(userId: string, id: string) {
    // Another user's alarm is a 404, not a 403: don't reveal that it exists.
    const alert = await this.prisma.priceAlert.findFirst({ where: { id, userId } });
    if (!alert) throw new NotFoundException('Alarm not found');
    return alert;
  }

  /** Status transitions are conditional so they can't race with the alert engine. */
  private async conditionalUpdate(
    id: string,
    userId: string,
    from: PriceAlert['status'][],
    data: Prisma.PriceAlertUpdateManyMutationInput,
  ): Promise<PriceAlert> {
    const res = await this.prisma.priceAlert.updateMany({ where: { id, userId, status: { in: from } }, data });
    const current = await this.prisma.priceAlert.findUniqueOrThrow({ where: { id } });
    if (res.count !== 1) {
      throw new ConflictException(`Alarm is ${current.status.toLowerCase()}; expected ${from.join(' or ').toLowerCase()}`);
    }
    return current;
  }

  private async notifyChanged(alertId: string) {
    try {
      await this.pubsub.publish(RedisChannels.alertChanged, { alertId });
    } catch (e) {
      // The engine's periodic resync picks it up anyway.
      this.logger.warn(`Could not publish alert change: ${(e as Error).message}`);
    }
  }

  /** Adds current price and the plan §6 warning when a fresh price already satisfies the alarm. */
  private async withMarket(alert: PriceAlert) {
    const base = serializeAlert(alert);
    try {
      const p = await this.market.getPrice(alert.symbol);
      const conditionMet =
        alert.status === 'ACTIVE' && p.price !== null && !p.isStale && shouldTrigger(p.price, base.targetPrice, alert.condition);
      return {
        ...base,
        currentPrice: p.price,
        isStale: p.isStale,
        distancePercent: p.price ? distancePercent(p.price, base.targetPrice) : null,
        ...(conditionMet && {
          warning: {
            code: 'CONDITION_ALREADY_MET',
            message: `${alert.symbol} is already ${alert.condition === 'ABOVE' ? 'at or above' : 'at or below'} ${base.targetPrice}; the alarm will trigger immediately.`,
          },
        }),
      };
    } catch {
      return { ...base, currentPrice: null, isStale: true, distancePercent: null };
    }
  }
}
