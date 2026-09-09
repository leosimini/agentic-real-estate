import { createAlertIdempotencyKey, createChangeEventKey } from './keys.js';
import { evaluateMeaningfulChange } from './policy.js';
import {
  DIGEST_GROUPS,
  type DigestGroupKind,
  type DigestOptions,
  type MonitorChangeEvent,
  type MonitorDigest,
  type SuppressedChange
} from './types.js';

const EVENT_GROUP: Readonly<Record<MonitorChangeEvent['type'], DigestGroupKind>> = {
  new_match: 'new_matches',
  price_changed: 'price_drops',
  availability_changed: 'availability_changes',
  sources_changed: 'source_changes',
  score_changed: 'score_changes',
  removed_match: 'removed_matches'
};

export function buildMonitorDigest(
  monitorId: string,
  windowKey: string,
  events: readonly MonitorChangeEvent[],
  options: DigestOptions = {}
): MonitorDigest | null {
  if (!monitorId.trim()) throw new Error('monitorId is required');
  if (!windowKey.trim()) throw new Error('windowKey is required');
  if (options.maxEventsPerGroup !== undefined &&
      (!Number.isInteger(options.maxEventsPerGroup) || options.maxEventsPerGroup < 1)) {
    throw new Error('maxEventsPerGroup must be a positive integer');
  }

  const suppressedProperties = new Set(options.suppressedPropertyIds ?? []);
  const deliveredKeys = new Set(options.previouslyDeliveredEventKeys ?? []);
  const seenKeys = new Set<string>();
  const suppressed: SuppressedChange[] = [];
  const grouped = new Map<DigestGroupKind, MonitorChangeEvent[]>();

  const orderedEvents = [...events].sort((left, right) =>
    createChangeEventKey(left).localeCompare(createChangeEventKey(right))
  );

  for (const event of orderedEvents) {
    if (event.monitorId !== monitorId) throw new Error('Digest event belongs to a different monitor');
    const eventKey = createChangeEventKey(event);
    const significance = evaluateMeaningfulChange(event, options.policy);
    if (!significance.meaningful) {
      suppressed.push({ event, reason: 'not_meaningful' });
      continue;
    }
    if (suppressedProperties.has(event.propertyId)) {
      suppressed.push({ event, reason: 'property_suppressed' });
      continue;
    }
    if (deliveredKeys.has(eventKey) || seenKeys.has(eventKey)) {
      suppressed.push({ event, reason: 'already_delivered' });
      continue;
    }

    const groupKind = EVENT_GROUP[event.type];
    const group = grouped.get(groupKind) ?? [];
    if (options.maxEventsPerGroup !== undefined && group.length >= options.maxEventsPerGroup) {
      suppressed.push({ event, reason: 'group_limit' });
      continue;
    }
    seenKeys.add(eventKey);
    group.push(event);
    grouped.set(groupKind, group);
  }

  const groups = DIGEST_GROUPS
    .filter((kind) => grouped.has(kind))
    .map((kind) => ({ kind, events: grouped.get(kind)! }));
  const includedEvents = groups.flatMap((group) => group.events);
  const alertKey = createAlertIdempotencyKey(monitorId, windowKey, includedEvents);
  if (!alertKey) return null;

  return {
    monitorId,
    windowKey,
    alertKey,
    groups,
    eventKeys: includedEvents.map(createChangeEventKey),
    suppressed
  };
}
