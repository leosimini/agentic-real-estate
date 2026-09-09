import {
  canonicalConfidenceStateSchema,
  sourceSnapshotSchema,
  type CanonicalConfidenceState,
  type Operation,
  type SourceSnapshot
} from '@realty/core';
import { fingerprintAddress, normalizeAddress } from './normalization.js';

export type CanonicalOutcome = CanonicalConfidenceState | 'no_match';

export type CanonicalSourceIdentity = {
  sourceCode: string;
  sourceListingId: string;
};

export type CanonicalCandidate = {
  propertyId: string;
  sourceIdentities?: readonly CanonicalSourceIdentity[];
  address: string | null;
  operation?: Operation | null;
  latitude?: number | null;
  longitude?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  areaTotalM2?: number | null;
};

export type CanonicalEvidence = {
  kind:
    | 'exact_source_identity'
    | 'exact_address'
    | 'exact_building'
    | 'same_unit'
    | 'missing_unit'
    | 'conflicting_unit'
    | 'same_operation'
    | 'conflicting_operation'
    | 'nearby_geo'
    | 'similar_structure';
  detail?: string;
};

export type CanonicalDecision = {
  propertyId: string;
  outcome: CanonicalOutcome;
  score: number;
  autoConfirm: boolean;
  evidence: CanonicalEvidence[];
};

export function scoreCanonicalCandidate(
  unvalidatedSnapshot: SourceSnapshot,
  candidate: CanonicalCandidate
): CanonicalDecision {
  const snapshot = sourceSnapshotSchema.parse(unvalidatedSnapshot);
  const evidence: CanonicalEvidence[] = [];
  const exactIdentity = candidate.sourceIdentities?.some(
    (identity) =>
      identity.sourceCode === snapshot.sourceCode &&
      identity.sourceListingId === snapshot.sourceListingId
  ) ?? false;

  if (exactIdentity) {
    evidence.push({ kind: 'exact_source_identity' });
    return decision(candidate.propertyId, 'confirmed', 100, evidence);
  }

  const incomingAddress = snapshot.normalized.address;
  if (!incomingAddress || !candidate.address) return decision(candidate.propertyId, 'no_match', 0, evidence);

  const incoming = fingerprintAddress(incomingAddress);
  const existing = fingerprintAddress(candidate.address);
  let score = 0;

  if (incoming.normalized === existing.normalized) {
    score += 55;
    evidence.push({ kind: 'exact_address' });
  } else if (incoming.building === existing.building) {
    score += 45;
    evidence.push({ kind: 'exact_building' });
  }

  if (incoming.unit && existing.unit) {
    if (incoming.unit !== existing.unit) {
      evidence.push({ kind: 'conflicting_unit' });
      return decision(candidate.propertyId, 'no_match', Math.min(score, 45), evidence);
    }
    score += 25;
    evidence.push({ kind: 'same_unit' });
  } else {
    evidence.push({ kind: 'missing_unit' });
  }

  const incomingOperation = snapshot.normalized.operation;
  if (incomingOperation && candidate.operation) {
    if (incomingOperation !== candidate.operation) {
      evidence.push({ kind: 'conflicting_operation' });
      return decision(candidate.propertyId, 'no_match', Math.min(score, 45), evidence);
    }
    score += 10;
    evidence.push({ kind: 'same_operation' });
  }

  const distance = distanceMeters(
    snapshot.normalized.latitude,
    snapshot.normalized.longitude,
    candidate.latitude,
    candidate.longitude
  );
  if (distance !== null && distance <= 50) {
    score += 10;
    evidence.push({ kind: 'nearby_geo', detail: `${Math.round(distance)}m` });
  }

  if (hasSimilarStructure(snapshot, candidate)) {
    score += 10;
    evidence.push({ kind: 'similar_structure' });
  }

  score = Math.min(100, score);
  const sameExplicitUnit = incoming.unit !== null && incoming.unit === existing.unit;
  if (incoming.building === existing.building && sameExplicitUnit && score >= 80) {
    return decision(candidate.propertyId, 'confirmed', score, evidence);
  }
  if (incoming.building === existing.building && score >= 65 && evidence.some((item) => item.kind === 'similar_structure')) {
    return decision(candidate.propertyId, 'likely', score, evidence);
  }
  if (incoming.building === existing.building || distance !== null && distance <= 50) {
    return decision(candidate.propertyId, 'potential', score, evidence);
  }
  return decision(candidate.propertyId, 'no_match', score, evidence);
}

export function rankCanonicalCandidates(
  snapshot: SourceSnapshot,
  candidates: readonly CanonicalCandidate[]
): CanonicalDecision[] {
  return candidates
    .map((candidate) => scoreCanonicalCandidate(snapshot, candidate))
    .sort((left, right) => right.score - left.score || left.propertyId.localeCompare(right.propertyId));
}

function decision(
  propertyId: string,
  outcome: CanonicalOutcome,
  score: number,
  evidence: CanonicalEvidence[]
): CanonicalDecision {
  if (outcome !== 'no_match') canonicalConfidenceStateSchema.parse(outcome);
  return {
    propertyId,
    outcome,
    score,
    autoConfirm: outcome === 'confirmed',
    evidence
  };
}

function hasSimilarStructure(snapshot: SourceSnapshot, candidate: CanonicalCandidate): boolean {
  const comparisons: boolean[] = [];
  compareExact(comparisons, snapshot.normalized.rooms, candidate.rooms);
  compareExact(comparisons, snapshot.normalized.bedrooms, candidate.bedrooms);
  if (snapshot.normalized.areaTotalM2 !== undefined && candidate.areaTotalM2 != null) {
    const maximum = Math.max(snapshot.normalized.areaTotalM2, candidate.areaTotalM2);
    comparisons.push(maximum > 0 && Math.abs(snapshot.normalized.areaTotalM2 - candidate.areaTotalM2) / maximum <= 0.08);
  }
  return comparisons.length >= 2 && comparisons.every(Boolean);
}

function compareExact(comparisons: boolean[], incoming: number | undefined, existing: number | null | undefined): void {
  if (incoming !== undefined && existing != null) comparisons.push(incoming === existing);
}

function distanceMeters(
  firstLatitude: number | undefined,
  firstLongitude: number | undefined,
  secondLatitude: number | null | undefined,
  secondLongitude: number | null | undefined
): number | null {
  if (
    firstLatitude === undefined ||
    firstLongitude === undefined ||
    secondLatitude == null ||
    secondLongitude == null
  ) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(secondLatitude - firstLatitude);
  const longitudeDelta = radians(secondLongitude - firstLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(firstLatitude)) * Math.cos(radians(secondLatitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export { normalizeAddress };
