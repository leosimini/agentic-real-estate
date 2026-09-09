import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  basicMatchScore,
  evaluateHardConstraints,
  matchesHardConstraints,
  scoreOpportunityPreferences,
  type Opportunity
} from '../src/index.js';

const baseOpportunity: Opportunity = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Sunny apartment',
  address: 'Av. Cabildo 1200, Belgrano, CABA',
  operation: 'sale',
  price: 240_000,
  currency: 'USD',
  areaTotalM2: 82,
  bedrooms: 2,
  rooms: 3,
  floor: '7',
  publicationCount: 2,
  lastVerifiedAt: '2026-09-09T12:00:00Z',
  preferenceMatches: ['Natural light']
};

describe('hard-constraint evaluation', () => {
  it('requires the requested operation', () => {
    assert.equal(matchesHardConstraints({ operation: 'sale' }, baseOpportunity), true);
    const result = evaluateHardConstraints({ operation: 'rent' }, baseOpportunity);
    assert.deepEqual(result.failures, [{ constraint: 'operation', reason: 'mismatch' }]);
  });

  it('matches currency case-insensitively and rejects mismatch or missing values', () => {
    assert.equal(matchesHardConstraints({ currency: 'usd' }, baseOpportunity), true);
    assert.equal(matchesHardConstraints({ currency: 'ARS' }, baseOpportunity), false);
    assert.deepEqual(
      evaluateHardConstraints({ currency: 'USD' }, { ...baseOpportunity, currency: null }).failures,
      [{ constraint: 'currency', reason: 'missing_value' }]
    );
  });

  it('matches any requested location using case- and accent-insensitive address text', () => {
    const opportunity = { ...baseOpportunity, address: 'Palermo, Ciudad Autónoma de Buenos Aires' };
    assert.equal(matchesHardConstraints({ locations: ['colegiales', 'autonoma'] }, opportunity), true);
    assert.equal(matchesHardConstraints({ locations: ['Rosario'] }, opportunity), false);
    assert.deepEqual(
      evaluateHardConstraints({ locations: ['Belgrano'] }, { ...opportunity, address: null }).failures,
      [{ constraint: 'location', reason: 'missing_value' }]
    );
  });

  it('enforces inclusive minimum and maximum prices', () => {
    assert.equal(matchesHardConstraints({ minPrice: 240_000, maxPrice: 240_000 }, baseOpportunity), true);
    assert.equal(matchesHardConstraints({ minPrice: 240_001 }, baseOpportunity), false);
    assert.equal(matchesHardConstraints({ maxPrice: 239_999 }, baseOpportunity), false);
  });

  it('enforces minimum area and rooms', () => {
    assert.equal(matchesHardConstraints({ minAreaM2: 82, rooms: 3 }, baseOpportunity), true);
    assert.equal(matchesHardConstraints({ minAreaM2: 83 }, baseOpportunity), false);
    assert.equal(matchesHardConstraints({ rooms: 4 }, baseOpportunity), false);
  });

  it('does not treat unknown numeric values as satisfying hard constraints', () => {
    const unknownValues = {
      ...baseOpportunity,
      price: null,
      areaTotalM2: null,
      bedrooms: null,
      rooms: null
    };
    const result = evaluateHardConstraints(
      { minPrice: 1, maxPrice: 300_000, minAreaM2: 1, bedrooms: 1, rooms: 1 },
      unknownValues
    );

    assert.equal(result.matches, false);
    assert.deepEqual(
      result.failures.map((failure) => failure.constraint),
      ['minPrice', 'maxPrice', 'minAreaM2', 'bedrooms', 'rooms']
    );
    assert.equal(result.failures.every((failure) => failure.reason === 'missing_value'), true);
  });
});

describe('preference scoring', () => {
  it('ranks preference evidence separately from eligibility', () => {
    assert.deepEqual(
      scoreOpportunityPreferences(['Natural light', 'Quiet street'], ['natural LIGHT']),
      { score: 50, matched: ['Natural light'], unmatched: ['Quiet street'] }
    );
    assert.equal(basicMatchScore({ operation: 'rent', preferences: ['Natural light'] }, baseOpportunity), 0);
    assert.equal(basicMatchScore({ operation: 'sale', preferences: ['Natural light'] }, baseOpportunity), 100);
  });
});
