import type { SourceSnapshot } from '@realty/core';

export function snapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    sourceCode: 'demo',
    sourceListingId: 'listing-1',
    directUrl: 'https://source.example/listings/1',
    fetchedAt: '2026-09-09T12:00:00Z',
    status: 'active',
    statusEvidence: {
      kind: 'api_field',
      observedAt: '2026-09-09T12:00:00Z',
      detail: 'status=active'
    },
    raw: { id: 'listing-1' },
    normalized: {
      address: 'Av. Cabildo 1.200, Depto B',
      operation: 'sale',
      currency: 'USD',
      price: 240_000,
      rooms: 3,
      bedrooms: 2,
      areaTotalM2: 82
    },
    ...overrides
  };
}
