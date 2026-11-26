import type { AlertEvent, PriceAlert } from '../../generated/prisma/client.js';

/** Decimals as strings and BigInts as strings: never floats in the API. */
export function serializeAlert(a: PriceAlert) {
  return {
    id: a.id,
    symbol: a.symbol,
    targetPrice: a.targetPrice.toString(),
    condition: a.condition,
    status: a.status,
    mode: a.mode,
    armed: a.armed,
    cooldownSeconds: a.cooldownSeconds,
    rearmMarginPercent: a.rearmMarginPercent.toString(),
    triggerCount: a.triggerCount,
    triggeredPrice: a.triggeredPrice?.toString() ?? null,
    triggeredAt: a.triggeredAt,
    lastTriggeredAt: a.lastTriggeredAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function serializeAlertEvent(e: AlertEvent) {
  return {
    id: e.id,
    alertId: e.alertId,
    sequence: e.sequence,
    symbol: e.symbol,
    condition: e.condition,
    targetPrice: e.targetPrice.toString(),
    triggeredPrice: e.triggeredPrice.toString(),
    triggeredAt: e.triggeredAt,
    tradeId: e.tradeId.toString(),
  };
}
