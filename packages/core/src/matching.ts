import type { Opportunity, SearchCriteria } from './contracts.js';

export type HardConstraint =
  | 'operation'
  | 'currency'
  | 'location'
  | 'minPrice'
  | 'maxPrice'
  | 'minAreaM2'
  | 'bedrooms'
  | 'rooms'
  | 'excludedFloors';

export type HardConstraintFailureReason =
  | 'missing_value'
  | 'mismatch'
  | 'below_minimum'
  | 'above_maximum'
  | 'excluded_value';

export type HardConstraintFailure = {
  constraint: HardConstraint;
  reason: HardConstraintFailureReason;
};

export type HardConstraintEvaluation = {
  matches: boolean;
  failures: HardConstraintFailure[];
};

export type PreferenceScore = {
  score: number;
  matched: string[];
  unmatched: string[];
};

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ');
}

function addMinimumFailure(
  failures: HardConstraintFailure[],
  constraint: 'minPrice' | 'minAreaM2' | 'bedrooms' | 'rooms',
  actual: number | null | undefined,
  minimum: number | undefined
): void {
  if (minimum === undefined) return;
  if (actual === null || actual === undefined) {
    failures.push({ constraint, reason: 'missing_value' });
  } else if (actual < minimum) {
    failures.push({ constraint, reason: 'below_minimum' });
  }
}

export function evaluateHardConstraints(
  criteria: SearchCriteria,
  opportunity: Opportunity
): HardConstraintEvaluation {
  const failures: HardConstraintFailure[] = [];

  if (criteria.operation !== undefined && opportunity.operation !== criteria.operation) {
    failures.push({ constraint: 'operation', reason: 'mismatch' });
  }

  if (criteria.currency !== undefined) {
    if (opportunity.currency === null) {
      failures.push({ constraint: 'currency', reason: 'missing_value' });
    } else if (normalizeText(opportunity.currency) !== normalizeText(criteria.currency)) {
      failures.push({ constraint: 'currency', reason: 'mismatch' });
    }
  }

  if (criteria.locations !== undefined) {
    if (opportunity.address === null) {
      failures.push({ constraint: 'location', reason: 'missing_value' });
    } else {
      const address = normalizeText(opportunity.address);
      const isInRequestedLocation = criteria.locations.some((location) =>
        address.includes(normalizeText(location))
      );
      if (!isInRequestedLocation) failures.push({ constraint: 'location', reason: 'mismatch' });
    }
  }

  addMinimumFailure(failures, 'minPrice', opportunity.price, criteria.minPrice);
  if (criteria.maxPrice !== undefined) {
    if (opportunity.price === null) {
      failures.push({ constraint: 'maxPrice', reason: 'missing_value' });
    } else if (opportunity.price > criteria.maxPrice) {
      failures.push({ constraint: 'maxPrice', reason: 'above_maximum' });
    }
  }
  addMinimumFailure(failures, 'minAreaM2', opportunity.areaTotalM2, criteria.minAreaM2);
  addMinimumFailure(failures, 'bedrooms', opportunity.bedrooms, criteria.bedrooms);
  addMinimumFailure(failures, 'rooms', opportunity.rooms, criteria.rooms);

  if (criteria.excludedFloors !== undefined) {
    if (opportunity.floor === null || opportunity.floor === undefined) {
      failures.push({ constraint: 'excludedFloors', reason: 'missing_value' });
    } else {
      const floor = normalizeText(opportunity.floor);
      if (criteria.excludedFloors.some((excluded) => normalizeText(excluded) === floor)) {
        failures.push({ constraint: 'excludedFloors', reason: 'excluded_value' });
      }
    }
  }

  return { matches: failures.length === 0, failures };
}

export function matchesHardConstraints(criteria: SearchCriteria, opportunity: Opportunity): boolean {
  return evaluateHardConstraints(criteria, opportunity).matches;
}

export function scoreOpportunityPreferences(
  requestedPreferences: readonly string[] = [],
  matchedPreferences: readonly string[] = []
): PreferenceScore {
  const requested = new Map(
    requestedPreferences.map((preference) => [normalizeText(preference), preference] as const)
  );
  const matchedKeys = new Set(matchedPreferences.map(normalizeText));
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const [key, label] of requested) {
    (matchedKeys.has(key) ? matched : unmatched).push(label);
  }

  return {
    score: requested.size === 0 ? 100 : Math.round((matched.length / requested.size) * 100),
    matched,
    unmatched
  };
}

/**
 * Compatibility helper for the current worker. Hard constraints always gate the
 * result; soft preference evidence only ranks opportunities that pass them.
 */
export function basicMatchScore(criteria: SearchCriteria, opportunity: Opportunity): number {
  if (!matchesHardConstraints(criteria, opportunity)) return 0;
  return scoreOpportunityPreferences(criteria.preferences, opportunity.preferenceMatches).score;
}
