import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalConfidenceStateSchema,
  searchCriteriaSchema,
  sourceSnapshotSchema
} from '../src/index.js';

describe('runtime contracts', () => {
  it('normalizes currency and accepts provenance-rich source snapshots', () => {
    const snapshot = sourceSnapshotSchema.parse({
      sourceCode: 'demo',
      sourceListingId: 'listing-1',
      directUrl: 'https://example.com/listings/1',
      fetchedAt: '2026-09-09T12:00:00Z',
      status: 'active',
      statusEvidence: {
        kind: 'http_status',
        observedAt: '2026-09-09T12:00:00Z',
        httpStatus: 200
      },
      raw: { id: 'listing-1' },
      normalized: { operation: 'sale', currency: 'usd', price: 250_000 }
    });

    assert.equal(snapshot.normalized.currency, 'USD');
  });

  it('rejects malformed source boundaries and inverted price ranges', () => {
    assert.equal(sourceSnapshotSchema.safeParse({}).success, false);
    assert.equal(searchCriteriaSchema.safeParse({ minPrice: 200, maxPrice: 100 }).success, false);
  });

  it('only accepts explicit canonical confidence states', () => {
    assert.equal(canonicalConfidenceStateSchema.safeParse('potential').success, true);
    assert.equal(canonicalConfidenceStateSchema.safeParse('auto_merged').success, false);
  });
});
