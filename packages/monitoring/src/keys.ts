import { createHash } from 'node:crypto';
import type { MonitorChangeEvent, NotificationChannel } from './types.js';

function digest(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

function moneyKey(money: { amount: number; currency: string } | null): string {
  return money ? `${money.currency.toUpperCase()}:${money.amount}` : 'none';
}

function candidateKey(candidate: {
  score: number;
  price: { amount: number; currency: string } | null;
  availability: string;
  activeSourceIds: readonly string[];
}): string {
  const sources = [...new Set(candidate.activeSourceIds.map((source) => source.trim()).filter(Boolean))]
    .sort()
    .join(',');
  return [candidate.score, moneyKey(candidate.price), candidate.availability, sources].join('|');
}

/** A semantic event identity. It intentionally excludes detection timestamps. */
export function createChangeEventKey(event: MonitorChangeEvent): string {
  const common = [event.monitorId, event.propertyId, event.type];
  let details: string[];

  switch (event.type) {
    case 'new_match':
      details = [candidateKey(event.current)];
      break;
    case 'removed_match':
      details = [candidateKey(event.previous)];
      break;
    case 'price_changed':
      details = [moneyKey(event.previous), moneyKey(event.current), String(event.score)];
      break;
    case 'availability_changed':
      details = [event.previous, event.current, String(event.score)];
      break;
    case 'sources_changed':
      details = [
        [...new Set(event.addedSourceIds)].sort().join(','),
        [...new Set(event.removedSourceIds)].sort().join(','),
        String(event.score)
      ];
      break;
    case 'score_changed':
      details = [String(event.previous), String(event.current)];
      break;
  }

  return `change:${digest([...common, ...details])}`;
}

export function createAlertIdempotencyKey(
  monitorId: string,
  windowKey: string,
  events: readonly MonitorChangeEvent[]
): string | null {
  if (!events.length) return null;
  if (!monitorId.trim()) throw new Error('monitorId is required');
  if (!windowKey.trim()) throw new Error('windowKey is required');
  if (events.some((event) => event.monitorId !== monitorId)) {
    throw new Error('Alert event belongs to a different monitor');
  }
  const eventKeys = [...new Set(events.map(createChangeEventKey))].sort();
  return `alert:${digest([monitorId, windowKey, ...eventKeys])}`;
}

export function createDeliveryIdempotencyKey(alertKey: string, channel: NotificationChannel): string {
  if (!alertKey.trim()) throw new Error('alertKey is required');
  return `delivery:${digest([alertKey, channel])}`;
}
