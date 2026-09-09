import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { DatabaseClient } from '@realty/db';
import {
  fingerprintAddress,
  normalizeAddress,
  rankCanonicalCandidates,
  type CanonicalCandidate,
  type CanonicalDecision
} from '@realty/ingestion';
import { sourceSnapshotSchema, type SourceSnapshot } from '@realty/core';

export const directPublicationInputSchema = z.object({
  address: z.string().trim().min(4).max(500),
  operation: z.enum(['sale', 'rent']),
  price: z.number().positive(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default('USD'),
  title: z.string().trim().min(2).max(240).optional(),
  description: z.string().trim().max(10_000).optional(),
  propertyType: z.string().trim().min(2).max(80).optional(),
  rooms: z.number().int().positive().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  areaTotalM2: z.number().positive().optional(),
  areaCoveredM2: z.number().positive().optional(),
  floor: z.string().trim().min(1).max(40).optional()
}).strict();

export type DirectPublicationInput = z.infer<typeof directPublicationInputSchema>;

type CandidateRow = {
  id: string;
  canonical_address: string | null;
  operation: 'sale' | 'rent' | 'wanted';
  latitude: string | null;
  longitude: string | null;
  rooms: number | null;
  bedrooms: number | null;
  area_total_m2: string | null;
  source_identities: Array<{ sourceCode: string; sourceListingId: string }> | null;
};

type PublicationResultRow = {
  id: string;
  property_id: string;
  source_listing_id: string;
  publication_status: string;
  raw_payload?: unknown;
  result_metadata?: {
    canonicalDecision?: DirectPublicationResult['canonicalDecision'];
    potentialDuplicateCount?: number;
  };
};

export class IdempotencyConflictError extends Error {
  override readonly name = 'IdempotencyConflictError';
}

export type DirectPublicationResult = {
  publicationId: string;
  propertyId: string;
  sourceListingId: string;
  status: string;
  replayed: boolean;
  canonicalDecision: 'new_property' | 'confirmed_existing';
  potentialDuplicateCount: number;
};

export async function createDirectPublication(
  client: DatabaseClient,
  options: {
    userId: string;
    displayName: string | null;
    idempotencyKey: string;
    publicWebUrl: string;
    input: DirectPublicationInput;
  }
): Promise<DirectPublicationResult> {
  const stableKey = createHash('sha256')
    .update(`direct-publication:${options.userId}:${options.idempotencyKey}`)
    .digest('hex');
  const sourceListingId = `manual-${stableKey.slice(0, 32)}`;

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [stableKey]);

  const replay = await client.query<PublicationResultRow>(`
    SELECT pub.id, pub.property_id, pub.source_listing_id, pub.publication_status,
      snap.raw_payload, snap.result_metadata
    FROM publication_snapshot snap
    JOIN source s ON s.id = snap.source_id
    JOIN publication pub ON pub.source_id = s.id AND pub.source_listing_id = snap.source_listing_id
    WHERE snap.idempotency_key = $1
  `, [stableKey]);
  if (replay.rows[0]) {
    const previousInput = directPublicationInputSchema.safeParse(replay.rows[0].raw_payload);
    if (!previousInput.success || !isDeepStrictEqual(previousInput.data, options.input)) {
      throw new IdempotencyConflictError('Idempotency-Key was already used with a different publication payload');
    }
    return toResult(
      replay.rows[0],
      true,
      replay.rows[0].result_metadata?.canonicalDecision ?? 'new_property',
      replay.rows[0].result_metadata?.potentialDuplicateCount ?? 0
    );
  }

  const source = await client.query<{ id: string }>('SELECT id FROM source WHERE code = $1', ['manual']);
  const sourceId = source.rows[0]?.id;
  if (!sourceId) throw new Error('Manual source is not configured');

  const normalizedAddress = normalizeAddress(options.input.address);
  const address = fingerprintAddress(options.input.address);
  if (address.unit) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `canonical:${options.input.operation}:${address.building}:${address.unit}`
    ]);
  }
  const candidates = await client.query<CandidateRow>(`
    SELECT p.id, p.canonical_address, p.operation, p.latitude, p.longitude,
      p.rooms, p.bedrooms, p.area_total_m2,
      COALESCE(
        json_agg(json_build_object('sourceCode', s.code, 'sourceListingId', pub.source_listing_id))
          FILTER (WHERE pub.id IS NOT NULL),
        '[]'::json
      ) AS source_identities
    FROM property p
    LEFT JOIN publication pub ON pub.property_id = p.id
    LEFT JOIN source s ON s.id = pub.source_id
    WHERE p.operation = $1
      AND (p.normalized_address = $2 OR similarity(p.normalized_address, $2) >= 0.45)
    GROUP BY p.id
    ORDER BY similarity(p.normalized_address, $2) DESC
    LIMIT 20
  `, [options.input.operation, normalizedAddress]);

  const now = new Date().toISOString();
  const provisionalSnapshot = sourceSnapshotSchema.parse({
    sourceCode: 'manual',
    sourceListingId,
    directUrl: `${options.publicWebUrl}/publications/${sourceListingId}`,
    fetchedAt: now,
    status: 'active',
    statusEvidence: { kind: 'manual', observedAt: now, detail: 'Submitted by an authenticated publisher' },
    raw: options.input,
    normalized: options.input
  });
  const ranked = rankCanonicalCandidates(provisionalSnapshot, candidates.rows.map(toCandidate));
  const confirmed = ranked.filter((decision) => decision.outcome === 'confirmed');
  const autoConfirmed = confirmed.length === 1 ? confirmed[0] : undefined;
  const reviewDecisions = confirmed.length > 1
    ? ranked.map((decision) => decision.outcome === 'confirmed'
      ? { ...decision, outcome: 'likely' as const, score: Math.min(decision.score, 79), autoConfirm: false }
      : decision)
    : ranked;
  const potentialDuplicateCount = reviewDecisions.filter(
    (decision) => decision.outcome === 'likely' || decision.outcome === 'potential'
  ).length;
  const canonicalDecision: DirectPublicationResult['canonicalDecision'] = autoConfirmed
    ? 'confirmed_existing'
    : 'new_property';

  let propertyId = autoConfirmed?.propertyId;
  if (!propertyId) {
    const property = await client.query<{ id: string }>(`
      INSERT INTO property (
        canonical_address, normalized_address, address_unit, property_type, operation,
        bedrooms, rooms, bathrooms, area_total_m2, area_covered_m2, floor,
        currency, canonical_price, last_verified_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
      RETURNING id
    `, [
      options.input.address,
      normalizedAddress,
      address.unit,
      options.input.propertyType ?? null,
      options.input.operation,
      options.input.bedrooms ?? null,
      options.input.rooms ?? null,
      options.input.bathrooms ?? null,
      options.input.areaTotalM2 ?? null,
      options.input.areaCoveredM2 ?? null,
      options.input.floor ?? null,
      options.input.currency,
      options.input.price
    ]);
    propertyId = property.rows[0]!.id;
  }

  const snapshot: SourceSnapshot = {
    ...provisionalSnapshot,
    directUrl: `${options.publicWebUrl}/opportunities/${propertyId}`
  };
  const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const insertedSnapshot = await client.query<{ id: string }>(`
    INSERT INTO publication_snapshot (
      source_id, source_listing_id, direct_url, fetched_at, source_status,
      status_evidence, content_hash, raw_payload, normalized_payload, idempotency_key,
      result_metadata
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb)
    RETURNING id
  `, [
    sourceId,
    sourceListingId,
    snapshot.directUrl,
    snapshot.fetchedAt,
    snapshot.status,
    JSON.stringify(snapshot.statusEvidence),
    contentHash,
    JSON.stringify(snapshot.raw),
    JSON.stringify(snapshot.normalized),
    stableKey,
    JSON.stringify({ canonicalDecision, potentialDuplicateCount })
  ]);
  const snapshotId = insertedSnapshot.rows[0]!.id;

  await persistDecisions(client, snapshotId, reviewDecisions);

  const publication = await client.query<PublicationResultRow>(`
    INSERT INTO publication (
      source_id, source_listing_id, source_url, property_id, publisher_type,
      publisher_user_id, publisher_name, title, description, currency, price,
      raw_payload, publication_status, last_seen_at, last_verified_at
    ) VALUES ($1,$2,$3,$4,'owner',$5,$6,$7,$8,$9,$10,$11::jsonb,'active',now(),now())
    RETURNING id, property_id, source_listing_id, publication_status
  `, [
    sourceId,
    sourceListingId,
    snapshot.directUrl,
    propertyId,
    options.userId,
    options.displayName,
    options.input.title ?? `${options.input.propertyType ?? 'Property'} in ${options.input.address}`,
    options.input.description ?? null,
    options.input.currency,
    options.input.price,
    JSON.stringify(options.input)
  ]);
  const created = publication.rows[0]!;

  await client.query(`
    INSERT INTO publication_event (publication_id, snapshot_id, event_type, payload)
    VALUES ($1,$2,'published',$3::jsonb)
  `, [created.id, snapshotId, JSON.stringify({ publisherType: 'owner' })]);
  await client.query(`
    INSERT INTO property_event (property_id, event_type, payload)
    VALUES ($1,'publication_added',$2::jsonb)
  `, [propertyId, JSON.stringify({ publicationId: created.id, sourceCode: 'manual' })]);
  await client.query(`
    INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES ($1,'publication.created','publication',$2,$3::jsonb)
  `, [options.userId, created.id, JSON.stringify({ propertyId, sourceListingId })]);

  return toResult(
    created,
    false,
    canonicalDecision,
    potentialDuplicateCount
  );
}

function toCandidate(row: CandidateRow): CanonicalCandidate {
  return {
    propertyId: row.id,
    sourceIdentities: row.source_identities ?? [],
    address: row.canonical_address,
    operation: row.operation,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    rooms: row.rooms,
    bedrooms: row.bedrooms,
    areaTotalM2: row.area_total_m2 === null ? null : Number(row.area_total_m2)
  };
}

async function persistDecisions(
  client: DatabaseClient,
  snapshotId: string,
  decisions: readonly CanonicalDecision[]
): Promise<void> {
  for (const decision of decisions) {
    if (decision.outcome === 'no_match') continue;
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO canonical_match_decision (
        snapshot_id, candidate_property_id, decision, confidence, evidence, decided_by
      ) VALUES ($1,$2,$3,$4,$5::jsonb,'deterministic')
      RETURNING id
    `, [snapshotId, decision.propertyId, decision.outcome, decision.score / 100, JSON.stringify(decision.evidence)]);
    if (decision.outcome !== 'confirmed') {
      await client.query('INSERT INTO duplicate_review (match_decision_id) VALUES ($1)', [inserted.rows[0]!.id]);
    }
  }
}

function toResult(
  row: PublicationResultRow,
  replayed: boolean,
  canonicalDecision: DirectPublicationResult['canonicalDecision'],
  potentialDuplicateCount: number
): DirectPublicationResult {
  return {
    publicationId: row.id,
    propertyId: row.property_id,
    sourceListingId: row.source_listing_id,
    status: row.publication_status,
    replayed,
    canonicalDecision,
    potentialDuplicateCount
  };
}
