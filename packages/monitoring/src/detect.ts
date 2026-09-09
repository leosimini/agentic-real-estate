import type {
  Money,
  MonitorCandidateSnapshot,
  MonitorChangeEvent,
  MonitorSnapshot
} from './types.js';

const EVENT_ORDER: Readonly<Record<MonitorChangeEvent['type'], number>> = {
  new_match: 0,
  price_changed: 1,
  availability_changed: 2,
  sources_changed: 3,
  score_changed: 4,
  removed_match: 5
};

function assertCandidate(candidate: MonitorCandidateSnapshot): void {
  if (!candidate.propertyId.trim()) throw new Error('propertyId is required');
  if (!Number.isFinite(candidate.score)) throw new Error(`Invalid score for property ${candidate.propertyId}`);
  if (candidate.price && (!Number.isFinite(candidate.price.amount) || candidate.price.amount < 0)) {
    throw new Error(`Invalid price for property ${candidate.propertyId}`);
  }
  if (candidate.price && !candidate.price.currency.trim()) {
    throw new Error(`Price currency is required for property ${candidate.propertyId}`);
  }
}

function indexCandidates(snapshot: MonitorSnapshot): Map<string, MonitorCandidateSnapshot> {
  const result = new Map<string, MonitorCandidateSnapshot>();
  for (const candidate of snapshot.candidates) {
    assertCandidate(candidate);
    if (result.has(candidate.propertyId)) {
      throw new Error(`Duplicate property ${candidate.propertyId} in monitor snapshot`);
    }
    result.set(candidate.propertyId, candidate);
  }
  return result;
}

function sameMoney(left: Money | null, right: Money | null): boolean {
  return left?.amount === right?.amount && left?.currency.toUpperCase() === right?.currency.toUpperCase();
}

function normalizedSources(candidate: MonitorCandidateSnapshot): string[] {
  return [...new Set(candidate.activeSourceIds.map((source) => source.trim()).filter(Boolean))].sort();
}

function compareEvents(left: MonitorChangeEvent, right: MonitorChangeEvent): number {
  return left.propertyId.localeCompare(right.propertyId) || EVENT_ORDER[left.type] - EVENT_ORDER[right.type];
}

/**
 * Compare two complete monitor snapshots. An absent previous snapshot represents
 * the first observation; an absent candidate in the current snapshot is a removal.
 */
export function detectMonitorChanges(
  previous: MonitorSnapshot | null,
  current: MonitorSnapshot
): MonitorChangeEvent[] {
  if (!current.monitorId.trim()) throw new Error('monitorId is required');
  if (previous && previous.monitorId !== current.monitorId) {
    throw new Error('Cannot compare snapshots from different monitors');
  }

  const before = previous ? indexCandidates(previous) : new Map<string, MonitorCandidateSnapshot>();
  const after = indexCandidates(current);
  const events: MonitorChangeEvent[] = [];

  for (const [propertyId, candidate] of after) {
    const prior = before.get(propertyId);
    if (!prior) {
      events.push({
        type: 'new_match',
        monitorId: current.monitorId,
        propertyId,
        detectedAt: current.observedAt,
        current: candidate
      });
      continue;
    }

    if (!sameMoney(prior.price, candidate.price)) {
      events.push({
        type: 'price_changed',
        monitorId: current.monitorId,
        propertyId,
        detectedAt: current.observedAt,
        previous: prior.price,
        current: candidate.price,
        score: candidate.score
      });
    }

    if (prior.availability !== candidate.availability) {
      events.push({
        type: 'availability_changed',
        monitorId: current.monitorId,
        propertyId,
        detectedAt: current.observedAt,
        previous: prior.availability,
        current: candidate.availability,
        score: candidate.score
      });
    }

    const priorSources = normalizedSources(prior);
    const currentSources = normalizedSources(candidate);
    const priorSet = new Set(priorSources);
    const currentSet = new Set(currentSources);
    const addedSourceIds = currentSources.filter((source) => !priorSet.has(source));
    const removedSourceIds = priorSources.filter((source) => !currentSet.has(source));
    if (addedSourceIds.length || removedSourceIds.length) {
      events.push({
        type: 'sources_changed',
        monitorId: current.monitorId,
        propertyId,
        detectedAt: current.observedAt,
        addedSourceIds,
        removedSourceIds,
        score: candidate.score
      });
    }

    if (prior.score !== candidate.score) {
      events.push({
        type: 'score_changed',
        monitorId: current.monitorId,
        propertyId,
        detectedAt: current.observedAt,
        previous: prior.score,
        current: candidate.score
      });
    }
  }

  for (const [propertyId, candidate] of before) {
    if (!after.has(propertyId)) {
      events.push({
        type: 'removed_match',
        monitorId: current.monitorId,
        propertyId,
        detectedAt: current.observedAt,
        previous: candidate
      });
    }
  }

  return events.sort(compareEvents);
}
