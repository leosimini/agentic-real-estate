import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMonitorDigest,
  createAlertIdempotencyKey,
  createChangeEventKey,
  createDeliveryIdempotencyKey,
  detectMonitorChanges,
  evaluateMeaningfulChange,
  type MonitorCandidateSnapshot,
  type MonitorSnapshot
} from '../src/index.js';

function candidate(
  propertyId: string,
  overrides: Partial<MonitorCandidateSnapshot> = {}
): MonitorCandidateSnapshot {
  return {
    propertyId,
    score: 90,
    price: { amount: 100_000, currency: 'USD' },
    availability: 'active',
    activeSourceIds: ['source-a'],
    ...overrides
  };
}

function snapshot(
  observationKey: string,
  candidates: readonly MonitorCandidateSnapshot[]
): MonitorSnapshot {
  return {
    monitorId: 'monitor-1',
    observationKey,
    observedAt: observationKey === 'run-1' ? '2026-01-01T10:00:00Z' : '2026-01-02T10:00:00Z',
    candidates
  };
}

test('detects deterministic new, changed, and removed events', () => {
  const before = snapshot('run-1', [candidate('changed'), candidate('removed')]);
  const after = snapshot('run-2', [
    candidate('changed', {
      score: 79,
      price: { amount: 95_000, currency: 'USD' },
      availability: 'uncertain',
      activeSourceIds: ['source-b']
    }),
    candidate('new')
  ]);

  const events = detectMonitorChanges(before, after);
  assert.deepEqual(events.map((event) => `${event.propertyId}:${event.type}`), [
    'changed:price_changed',
    'changed:availability_changed',
    'changed:sources_changed',
    'changed:score_changed',
    'new:new_match',
    'removed:removed_match'
  ]);
});

test('unchanged reruns produce no new event, digest, or alert key', () => {
  const initial = snapshot('run-1', [candidate('property-1', {
    activeSourceIds: ['source-a', 'source-b']
  })]);
  const firstEvents = detectMonitorChanges(null, initial);
  const firstDigest = buildMonitorDigest('monitor-1', '2026-01-01', firstEvents);
  assert.equal(firstEvents.length, 1);
  assert.ok(firstDigest?.alertKey);

  const rerun = snapshot('run-2', [candidate('property-1', {
    activeSourceIds: ['source-b', 'source-a', 'source-a']
  })]);
  const repeatedEvents = detectMonitorChanges(initial, rerun);
  assert.deepEqual(repeatedEvents, []);
  assert.equal(buildMonitorDigest('monitor-1', '2026-01-01', repeatedEvents), null);
  assert.equal(createAlertIdempotencyKey('monitor-1', '2026-01-01', repeatedEvents), null);
});

test('event and alert keys are stable across retry timestamps and input ordering', () => {
  const events = detectMonitorChanges(null, snapshot('run-1', [candidate('b'), candidate('a')]));
  const retriedEvents = events.map((event) => ({ ...event, detectedAt: '2026-01-01T10:05:00Z' }));

  assert.deepEqual(events.map(createChangeEventKey), retriedEvents.map(createChangeEventKey));
  assert.equal(
    createAlertIdempotencyKey('monitor-1', '2026-01-01', events),
    createAlertIdempotencyKey('monitor-1', '2026-01-01', [...retriedEvents].reverse())
  );
});

test('same alert and channel always produce the same delivery key', () => {
  const first = createDeliveryIdempotencyKey('alert:stable', 'email');
  const retry = createDeliveryIdempotencyKey('alert:stable', 'email');
  assert.equal(first, retry);
  assert.notEqual(first, createDeliveryIdempotencyKey('alert:stable', 'push'));
  assert.notEqual(first, createDeliveryIdempotencyKey('alert:other', 'email'));
});

test('meaningful policy handles price drops, availability, sources, and score crossings', () => {
  const before = snapshot('run-1', [candidate('property-1', { score: 79 })]);
  const after = snapshot('run-2', [candidate('property-1', {
    score: 82,
    price: { amount: 96_000, currency: 'USD' },
    availability: 'uncertain',
    activeSourceIds: ['source-a', 'source-b']
  })]);
  const events = detectMonitorChanges(before, after);

  for (const type of ['price_changed', 'availability_changed', 'sources_changed', 'score_changed'] as const) {
    const event = events.find((candidateEvent) => candidateEvent.type === type);
    assert.ok(event);
    assert.equal(evaluateMeaningfulChange(event).meaningful, true);
  }

  const smallDrop = detectMonitorChanges(
    snapshot('run-1', [candidate('small')]),
    snapshot('run-2', [candidate('small', { price: { amount: 99_000, currency: 'USD' } })])
  )[0];
  assert.ok(smallDrop);
  assert.equal(evaluateMeaningfulChange(smallDrop).meaningful, false);
});

test('digest groups meaningful events and suppresses delivered, dismissed, and noisy changes', () => {
  const events = detectMonitorChanges(null, snapshot('run-1', [
    candidate('delivered'),
    candidate('dismissed'),
    candidate('included'),
    candidate('below-threshold', { score: 70 })
  ]));
  const deliveredEvent = events.find((event) => event.propertyId === 'delivered');
  assert.ok(deliveredEvent);

  const digest = buildMonitorDigest('monitor-1', '2026-01-01', events, {
    previouslyDeliveredEventKeys: [createChangeEventKey(deliveredEvent)],
    suppressedPropertyIds: ['dismissed']
  });

  assert.ok(digest);
  assert.deepEqual(digest.groups.map((group) => group.kind), ['new_matches']);
  assert.deepEqual(digest.groups[0]?.events.map((event) => event.propertyId), ['included']);
  assert.deepEqual(
    digest.suppressed.map(({ event, reason }) => `${event.propertyId}:${reason}`).sort(),
    [
      'below-threshold:not_meaningful',
      'delivered:already_delivered',
      'dismissed:property_suppressed'
    ]
  );
});
