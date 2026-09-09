import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeAddress,
  scoreCanonicalCandidate,
  type CanonicalCandidate
} from '../src/index.js';
import { snapshot } from './fixtures.js';

const candidate: CanonicalCandidate = {
  propertyId: '00000000-0000-4000-8000-000000000001',
  sourceIdentities: [{ sourceCode: 'other', sourceListingId: 'external-1' }],
  address: 'Avenida Cabildo 1200 Departamento B',
  operation: 'sale',
  rooms: 3,
  bedrooms: 2,
  areaTotalM2: 82
};

describe('address normalization', () => {
  it('normalizes abbreviations, accents, punctuation, and thousands separators deterministically', () => {
    assert.equal(
      normalizeAddress('Av. Cabildo 1.200, Depto B'),
      normalizeAddress('AVENIDA CABILDO 1200 departamento B')
    );
  });
});

describe('canonical candidate scoring', () => {
  it('confirms exact source identity independent of mutable listing fields', () => {
    const result = scoreCanonicalCandidate(snapshot({ normalized: {} }), {
      ...candidate,
      address: null,
      sourceIdentities: [{ sourceCode: 'demo', sourceListingId: 'listing-1' }]
    });

    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.autoConfirm, true);
    assert.deepEqual(result.evidence, [{ kind: 'exact_source_identity' }]);
  });

  it('confirms an exact normalized address only with the same explicit unit', () => {
    const result = scoreCanonicalCandidate(snapshot(), candidate);
    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.autoConfirm, true);
    assert.equal(result.evidence.some((item) => item.kind === 'same_unit'), true);
  });

  it('keeps an ambiguous same-building record as a potential duplicate', () => {
    const result = scoreCanonicalCandidate(
      snapshot({
        normalized: {
          address: 'Avenida Cabildo 1200',
          operation: 'sale',
          rooms: 1,
          areaTotalM2: 35
        }
      }),
      candidate
    );

    assert.equal(result.outcome, 'potential');
    assert.equal(result.autoConfirm, false);
    assert.equal(result.evidence.some((item) => item.kind === 'missing_unit'), true);
  });

  it('never confirms likely evidence and rejects conflicting explicit units', () => {
    const likely = scoreCanonicalCandidate(
      snapshot({ normalized: { address: 'Cabildo 1200', operation: 'sale', rooms: 3, bedrooms: 2, areaTotalM2: 82 } }),
      { ...candidate, address: 'Cabildo 1200' }
    );
    assert.equal(likely.outcome, 'likely');
    assert.equal(likely.autoConfirm, false);

    const conflict = scoreCanonicalCandidate(
      snapshot({ normalized: { address: 'Av. Cabildo 1200, Depto A', operation: 'sale' } }),
      candidate
    );
    assert.equal(conflict.outcome, 'no_match');
    assert.equal(conflict.autoConfirm, false);
  });
});
