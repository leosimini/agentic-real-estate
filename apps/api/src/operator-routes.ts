import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  inquiryDtoSchema,
  listingClaimDtoSchema,
  managedPublicationDtoSchema,
  operatorProfileDtoSchema,
  publicationDtoSchema
} from '@realty/core';
import { query, withTransaction } from '@realty/db';
import { authenticate } from './auth.js';
import type { ApiConfig } from './config.js';
import { createDirectPublication, directPublicationInputSchema } from './publications.js';

const profileInputSchema = z.object({
  displayName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().min(2).max(200).optional(),
  licenseNumber: z.string().trim().min(2).max(120).optional(),
  websiteUrl: z.string().trim().url().max(500).optional()
}).strict();
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const publicationUpdateSchema = z.object({
  status: z.enum(['active', 'paused', 'removed']).optional(),
  declaredAvailability: z.enum(['available', 'reserved', 'sold', 'rented', 'unavailable', 'unknown']).optional(),
  price: z.number().positive().optional(),
  description: z.string().trim().max(10_000).nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });
const claimInputSchema = z.object({
  publicationId: z.string().uuid(),
  evidence: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: 'Claim evidence is required'
  })
}).strict();
const claimReviewSchema = z.object({
  status: z.enum(['approved', 'rejected', 'revoked'])
}).strict();
const inquiryInputSchema = z.object({
  propertyId: z.string().uuid(),
  publicationId: z.string().uuid().optional(),
  message: z.string().trim().min(10).max(4000)
}).strict();
const inquiryUpdateSchema = z.object({ status: z.enum(['read', 'replied', 'closed']) }).strict();
const importInputSchema = z.object({
  format: z.enum(['csv', 'json', 'xml', 'api']).default('json'),
  filename: z.string().trim().min(1).max(255).optional(),
  items: z.array(directPublicationInputSchema).min(1).max(100)
}).strict();

type ProfileRow = {
  id: string;
  user_id: string;
  display_name: string;
  legal_name: string | null;
  license_number: string | null;
  website_url: string | null;
  verification_status: 'pending' | 'verified' | 'rejected' | 'suspended';
  verified_at: Date | null;
  created_at: Date;
};

type ManagedPublicationRow = {
  id: string;
  property_id: string;
  source_listing_id: string;
  source_url: string;
  publisher_type: 'owner' | 'operator' | 'aggregated';
  publisher_name: string | null;
  title: string | null;
  description: string | null;
  currency: string | null;
  price: string | null;
  publication_status: 'active' | 'paused' | 'removed' | 'unknown';
  first_seen_at: Date;
  last_seen_at: Date;
  last_verified_at: Date | null;
  source_code: string;
  source_name: string;
  source_id: string;
  canonical_address: string | null;
  property_status: 'active' | 'uncertain' | 'inactive' | 'sold' | 'rented';
  declared_availability: 'available' | 'reserved' | 'sold' | 'rented' | 'unavailable' | 'unknown';
  version: number;
};

type ClaimRow = {
  id: string;
  publication_id: string;
  property_id: string;
  canonical_address: string | null;
  source_name: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  evidence: Record<string, unknown>;
  reviewed_at: Date | null;
  created_at: Date;
};

type InquiryRow = {
  id: string;
  property_id: string;
  publication_id: string;
  sender_user_id: string;
  recipient_user_id: string;
  message: string;
  status: 'new' | 'read' | 'replied' | 'closed';
  created_at: Date;
  updated_at: Date;
};

function profileDto(row: ProfileRow) {
  return operatorProfileDtoSchema.parse({
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    licenseNumber: row.license_number,
    websiteUrl: row.website_url,
    verificationStatus: row.verification_status,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  });
}

function managedPublicationDto(row: ManagedPublicationRow) {
  return managedPublicationDtoSchema.parse({
    ...publicationDtoSchema.parse({
      id: row.id,
      propertyId: row.property_id,
      sourceCode: row.source_code,
      sourceName: row.source_name,
      sourceListingId: row.source_listing_id,
      sourceUrl: row.source_url,
      publisherType: row.publisher_type,
      publisherName: row.publisher_name,
      title: row.title,
      description: row.description,
      currency: row.currency,
      price: row.price === null ? null : Number(row.price),
      status: row.publication_status,
      firstSeenAt: row.first_seen_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      lastVerifiedAt: row.last_verified_at?.toISOString() ?? null
    }),
    address: row.canonical_address,
    propertyStatus: row.property_status,
    declaredAvailability: row.declared_availability,
    version: row.version
  });
}

function claimDto(row: ClaimRow) {
  return listingClaimDtoSchema.parse({
    id: row.id,
    publicationId: row.publication_id,
    propertyId: row.property_id,
    address: row.canonical_address,
    sourceName: row.source_name,
    status: row.status,
    evidence: row.evidence,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  });
}

function inquiryDto(row: InquiryRow) {
  return inquiryDtoSchema.parse({
    id: row.id,
    propertyId: row.property_id,
    publicationId: row.publication_id,
    senderUserId: row.sender_user_id,
    recipientUserId: row.recipient_user_id,
    message: row.message,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  });
}

async function currentProfile(userId: string): Promise<ProfileRow | undefined> {
  return (await query<ProfileRow>('SELECT * FROM operator_profile WHERE user_id=$1', [userId])).rows[0];
}

const managedPublicationSelect = `
  SELECT pub.*, s.code AS source_code, s.name AS source_name,
    p.canonical_address, p.status AS property_status
  FROM publication pub
  JOIN source s ON s.id=pub.source_id
  JOIN property p ON p.id=pub.property_id
`;

const claimSelect = `
  SELECT c.id, c.publication_id, pub.property_id, p.canonical_address,
    s.name AS source_name, c.status, c.evidence, c.reviewed_at, c.created_at
  FROM listing_claim c
  JOIN publication pub ON pub.id=c.publication_id
  JOIN property p ON p.id=pub.property_id
  JOIN source s ON s.id=pub.source_id
`;

export async function registerOperatorRoutes(app: FastifyInstance, config: ApiConfig): Promise<void> {
  app.post('/v1/operators/profile', { preHandler: authenticate }, async (request, reply) => {
    const input = profileInputSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { code: 'invalid_request', details: input.error.flatten() } });
    try {
      const profile = await withTransaction(async (client) => {
        const inserted = await client.query<ProfileRow>(`
          INSERT INTO operator_profile (user_id, display_name, legal_name, license_number, website_url)
          VALUES ($1,$2,$3,$4,$5) RETURNING *
        `, [request.user.sub, input.data.displayName, input.data.legalName ?? null, input.data.licenseNumber ?? null, input.data.websiteUrl ?? null]);
        await client.query(`UPDATE app_user SET role='operator' WHERE id=$1`, [request.user.sub]);
        await client.query(`
          INSERT INTO operator_membership (operator_profile_id, user_id, role)
          VALUES ($1,$2,'owner')
        `, [inserted.rows[0]!.id, request.user.sub]);
        await client.query(`
          INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id)
          VALUES ($1,'operator_profile.created','operator_profile',$2)
        `, [request.user.sub, inserted.rows[0]!.id]);
        return inserted.rows[0]!;
      });
      return reply.code(201).send(profileDto(profile));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: { code: 'profile_exists', message: 'This account already has an operator profile' } });
      }
      throw error;
    }
  });

  app.get('/v1/operators/profile', { preHandler: authenticate }, async (request, reply) => {
    const profile = await currentProfile(request.user.sub);
    if (!profile) return reply.code(404).send({ error: { code: 'not_found', message: 'Operator profile was not found' } });
    return profileDto(profile);
  });

  app.get('/v1/publications/mine', { preHandler: authenticate }, async (request) => {
    const result = await query<ManagedPublicationRow>(`
      ${managedPublicationSelect}
      WHERE pub.publisher_user_id=$1
      ORDER BY pub.first_seen_at DESC LIMIT 200
    `, [request.user.sub]);
    return { items: result.rows.map(managedPublicationDto) };
  });

  app.patch('/v1/publications/:id', { preHandler: authenticate }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const input = publicationUpdateSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', details: input.success ? undefined : input.error.flatten() } });
    }
    const expectedVersion = Number(request.headers['if-match']);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return reply.code(428).send({ error: { code: 'version_required', message: 'A numeric If-Match publication version is required' } });
    }
    const updated = await withTransaction(async (client) => {
      const result = await client.query<ManagedPublicationRow>(`
        UPDATE publication SET
          publication_status=COALESCE($3,publication_status),
          declared_availability=COALESCE($4,declared_availability),
          price=COALESCE($5,price),
          description=CASE WHEN $6::boolean THEN $7 ELSE description END,
          last_seen_at=now(), last_verified_at=now(), updated_at=now(), version=version+1
        WHERE id=$1 AND publisher_user_id=$2 AND version=$8
        RETURNING *,
          (SELECT code FROM source WHERE id=publication.source_id) AS source_code,
          (SELECT name FROM source WHERE id=publication.source_id) AS source_name,
          (SELECT canonical_address FROM property WHERE id=publication.property_id) AS canonical_address,
          (SELECT status FROM property WHERE id=publication.property_id) AS property_status
      `, [
        params.data.id, request.user.sub, input.data.status ?? null,
        input.data.declaredAvailability ?? null, input.data.price ?? null,
        input.data.description !== undefined, input.data.description ?? null, expectedVersion
      ]);
      const publication = result.rows[0];
      if (!publication) {
        const accessible = await client.query<{ version: number }>(
          'SELECT version FROM publication WHERE id=$1 AND publisher_user_id=$2',
          [params.data.id, request.user.sub]
        );
        return accessible.rows[0] ? { conflictVersion: accessible.rows[0].version } : null;
      }
      const snapshot = await client.query<{ id: string }>(`
        INSERT INTO publication_snapshot (
          source_id, source_listing_id, direct_url, fetched_at, source_status,
          status_evidence, content_hash, raw_payload, normalized_payload, idempotency_key
        ) VALUES (
          $1,$2,$3,now(),$4,$5::jsonb,
          encode(digest($6::text,'sha256'),'hex'),$6::jsonb,$7::jsonb,$8
        ) RETURNING id
      `, [
        publication.source_id,
        publication.source_listing_id,
        publication.source_url,
        publication.publication_status,
        JSON.stringify({ kind: 'manual', observedAt: new Date().toISOString(), detail: 'Updated by the authenticated publisher' }),
        JSON.stringify({ publicationId: publication.id, version: publication.version, changes: input.data }),
        JSON.stringify({
          description: publication.description ?? undefined,
          currency: publication.currency ?? undefined,
          price: publication.price === null ? undefined : Number(publication.price)
        }),
        `publisher-update:${publication.id}:${publication.version}`
      ]);
      await client.query(`
        INSERT INTO publication_event (publication_id, snapshot_id, event_type, payload)
        VALUES ($1,$2,'publisher_updated',$3::jsonb)
      `, [publication.id, snapshot.rows[0]!.id, JSON.stringify(input.data)]);
      await client.query(`
        INSERT INTO property_event (property_id, event_type, payload)
        VALUES ($1,'publisher_update',$2::jsonb)
      `, [publication.property_id, JSON.stringify({ publicationId: publication.id, ...input.data })]);
      await client.query(`
        WITH best AS (
          SELECT price, currency FROM publication
          WHERE property_id=$1 AND publication_status='active'
          ORDER BY last_verified_at DESC NULLS LAST, id LIMIT 1
        )
        UPDATE property SET canonical_price=best.price, currency=best.currency,
          status=CASE
            WHEN $2='sold' THEN 'sold'
            WHEN $2='rented' THEN 'rented'
            ELSE 'active'
          END,
          last_verified_at=now()
        FROM best WHERE property.id=$1
      `, [publication.property_id, input.data.declaredAvailability ?? publication.declared_availability]);
      const activeCount = await client.query<{ count: string }>(`
        SELECT count(*) FROM publication
        WHERE property_id=$1 AND publication_status='active' AND declared_availability IN ('available','unknown')
      `, [publication.property_id]);
      if (Number(activeCount.rows[0]?.count ?? 0) === 0 && !['sold', 'rented'].includes(input.data.declaredAvailability ?? '')) {
        await client.query(`UPDATE property SET status='inactive', last_verified_at=now() WHERE id=$1`, [publication.property_id]);
      }
      await client.query(`
        INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id, metadata)
        VALUES ($1,'publication.updated','publication',$2,$3::jsonb)
      `, [request.user.sub, publication.id, JSON.stringify(input.data)]);
      return { publication };
    });
    if (!updated) return reply.code(404).send({ error: { code: 'not_found', message: 'Publication was not found' } });
    if ('conflictVersion' in updated) {
      return reply.code(409).send({ error: { code: 'version_conflict', message: 'Publication changed; reload before editing', currentVersion: updated.conflictVersion } });
    }
    const refreshed = await query<ManagedPublicationRow>(`${managedPublicationSelect} WHERE pub.id=$1`, [updated.publication.id]);
    return managedPublicationDto(refreshed.rows[0]!);
  });

  app.post('/v1/operators/claims', { preHandler: authenticate }, async (request, reply) => {
    const input = claimInputSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { code: 'invalid_request', details: input.error.flatten() } });
    const profile = await currentProfile(request.user.sub);
    if (!profile || profile.verification_status !== 'verified') {
      return reply.code(403).send({ error: { code: 'verified_operator_required', message: 'A verified operator profile is required to claim listings' } });
    }
    try {
      const result = await query<ClaimRow>(`
        WITH inserted AS (
          INSERT INTO listing_claim (publication_id, operator_profile_id, created_by, evidence)
          SELECT pub.id, $2, $3, $4::jsonb FROM publication pub
          WHERE pub.id=$1 AND pub.publisher_type='aggregated'
          RETURNING *
        )
        SELECT c.id, c.publication_id, pub.property_id, p.canonical_address,
          s.name AS source_name, c.status, c.evidence, c.reviewed_at, c.created_at
        FROM inserted c
        JOIN publication pub ON pub.id=c.publication_id
        JOIN property p ON p.id=pub.property_id
        JOIN source s ON s.id=pub.source_id
      `, [input.data.publicationId, profile.id, request.user.sub, JSON.stringify(input.data.evidence)]);
      if (!result.rows[0]) return reply.code(422).send({ error: { code: 'not_claimable', message: 'Only aggregated publications can be claimed' } });
      return reply.code(201).send(claimDto(result.rows[0]));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: { code: 'claim_exists', message: 'A claim already exists for this publication' } });
      }
      throw error;
    }
  });

  app.get('/v1/operators/claims', { preHandler: authenticate }, async (request, reply) => {
    const profile = await currentProfile(request.user.sub);
    if (!profile) return reply.code(403).send({ error: { code: 'operator_required', message: 'Create an operator profile first' } });
    const result = await query<ClaimRow>(`${claimSelect} WHERE c.operator_profile_id=$1 ORDER BY c.created_at DESC`, [profile.id]);
    return { items: result.rows.map(claimDto) };
  });

  app.patch('/v1/admin/claims/:id', { preHandler: authenticate }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.code(403).send({ error: { code: 'forbidden', message: 'Administrator access is required' } });
    const params = idParamsSchema.safeParse(request.params);
    const input = claimReviewSchema.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: { code: 'invalid_request' } });
    try {
      const claim = await withTransaction(async (client) => {
        const locked = await client.query<ClaimRow & { operator_profile_id: string; operator_user_id: string; operator_name: string; verification_status: string; publisher_type: string; title: string | null; description: string | null; currency: string | null; price: string | null }>(`
          SELECT c.id, c.publication_id, pub.property_id, p.canonical_address,
            s.name AS source_name, c.status, c.evidence, c.reviewed_at, c.created_at,
            c.operator_profile_id, profile.user_id AS operator_user_id, profile.display_name AS operator_name,
            profile.verification_status, pub.publisher_type, pub.title, pub.description, pub.currency, pub.price
          FROM listing_claim c
          JOIN operator_profile profile ON profile.id=c.operator_profile_id
          JOIN publication pub ON pub.id=c.publication_id
          JOIN property p ON p.id=pub.property_id
          JOIN source s ON s.id=pub.source_id
          WHERE c.id=$1 FOR UPDATE OF c, pub
        `, [params.data.id]);
        const existing = locked.rows[0];
        if (!existing) return null;
        if (input.data.status === 'approved' && (existing.publisher_type !== 'aggregated' || existing.verification_status !== 'verified')) {
          return { ineligible: true as const };
        }
        const updated = await client.query<ClaimRow>(`
          WITH reviewed AS (
            UPDATE listing_claim SET status=$2, reviewed_by=$3, reviewed_at=now()
            WHERE id=$1 RETURNING *
          )
          SELECT c.id, c.publication_id, pub.property_id, p.canonical_address,
            s.name AS source_name, c.status, c.evidence, c.reviewed_at, c.created_at
          FROM reviewed c
          JOIN publication pub ON pub.id=c.publication_id
          JOIN property p ON p.id=pub.property_id
          JOIN source s ON s.id=pub.source_id
        `, [params.data.id, input.data.status, request.user.sub]);
        const row = updated.rows[0];
        if (!row) return null;
        if (input.data.status === 'approved') {
          const source = await client.query<{ id: string }>(`SELECT id FROM source WHERE code='manual'`);
          const operatorPublication = await client.query<{ id: string; source_listing_id: string; source_url: string }>(`
            INSERT INTO publication (
              source_id, source_listing_id, source_url, property_id, publisher_type,
              publisher_user_id, publisher_operator_profile_id, publisher_name, title,
              description, currency, price, raw_payload, publication_status,
              last_seen_at, last_verified_at
            ) VALUES ($1,$2,$3,$4,'operator',$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'active',now(),now())
            RETURNING id, source_listing_id, source_url
          `, [
            source.rows[0]!.id,
            `claim-${row.id}`,
            `${config.publicWebUrl}/opportunities/${existing.property_id}`,
            existing.property_id,
            existing.operator_user_id,
            existing.operator_profile_id,
            existing.operator_name,
            existing.title,
            existing.description,
            existing.currency,
            existing.price,
            JSON.stringify({ claimedFromPublicationId: existing.publication_id })
          ]);
          await client.query(`UPDATE listing_claim SET operator_publication_id=$2 WHERE id=$1`, [row.id, operatorPublication.rows[0]!.id]);
          const snapshot = await client.query<{ id: string }>(`
            INSERT INTO publication_snapshot (
              source_id, source_listing_id, direct_url, fetched_at, source_status,
              status_evidence, content_hash, raw_payload, normalized_payload, idempotency_key
            ) VALUES (
              $1,$2,$3,now(),'active',$4::jsonb,
              encode(digest($5::text,'sha256'),'hex'),$5::jsonb,$6::jsonb,$7
            ) RETURNING id
          `, [
            source.rows[0]!.id,
            operatorPublication.rows[0]!.source_listing_id,
            operatorPublication.rows[0]!.source_url,
            JSON.stringify({ kind: 'manual', observedAt: new Date().toISOString(), detail: 'Approved operator claim' }),
            JSON.stringify({ claimId: row.id, sourcePublicationId: existing.publication_id }),
            JSON.stringify({
              title: existing.title ?? undefined,
              description: existing.description ?? undefined,
              currency: existing.currency ?? undefined,
              price: existing.price === null ? undefined : Number(existing.price)
            }),
            `claim-publication:${row.id}`
          ]);
          await client.query(`
            INSERT INTO publication_event (publication_id, snapshot_id, event_type, payload)
            VALUES ($1,$2,'claimed_from_aggregate',$3::jsonb)
          `, [operatorPublication.rows[0]!.id, snapshot.rows[0]!.id, JSON.stringify({ sourcePublicationId: existing.publication_id, claimId: row.id })]);
        } else if (input.data.status === 'revoked') {
          await client.query(`
            UPDATE publication SET publication_status='paused', declared_availability='unavailable',
              version=version+1, updated_at=now()
            WHERE id=(SELECT operator_publication_id FROM listing_claim WHERE id=$1)
          `, [row.id]);
        }
        await client.query(`
          INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id, metadata)
          VALUES ($1,'listing_claim.reviewed','listing_claim',$2,$3::jsonb)
        `, [request.user.sub, row.id, JSON.stringify({ status: input.data.status })]);
        return row;
      });
      if (!claim) return reply.code(404).send({ error: { code: 'not_found', message: 'Claim was not found' } });
      if ('ineligible' in claim) return reply.code(409).send({ error: { code: 'claim_ineligible', message: 'Claim or operator is no longer eligible' } });
      return claimDto(claim);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: { code: 'publication_already_claimed', message: 'This publication already has an approved claim' } });
      }
      throw error;
    }
  });

  app.post('/v1/operators/imports', { preHandler: authenticate }, async (request, reply) => {
    const input = importInputSchema.safeParse(request.body);
    const idempotencyKey = request.headers['idempotency-key'];
    if (!input.success) return reply.code(400).send({ error: { code: 'invalid_request', details: input.error.flatten() } });
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return reply.code(400).send({ error: { code: 'invalid_idempotency_key', message: 'Idempotency-Key must contain 8 to 200 characters' } });
    }
    const profile = await currentProfile(request.user.sub);
    if (!profile || profile.verification_status !== 'verified') {
      return reply.code(403).send({ error: { code: 'verified_operator_required', message: 'A verified operator profile is required for bulk imports' } });
    }
    try {
      const result = await withTransaction(async (client) => {
        const batch = await client.query<{ id: string; status: string; total_count: number; succeeded_count: number }>(`
          INSERT INTO operator_import (operator_profile_id, idempotency_key, format, filename, total_count)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (operator_profile_id, idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key
          RETURNING id,status,total_count,succeeded_count
        `, [profile.id, idempotencyKey, input.data.format, input.data.filename ?? null, input.data.items.length]);
        const existing = batch.rows[0]!;
        if (existing.status === 'completed') return { importId: existing.id, importedCount: existing.succeeded_count, replayed: true };
        let importedCount = 0;
        for (const [index, item] of input.data.items.entries()) {
          await createDirectPublication(client, {
            userId: request.user.sub,
            displayName: profile.display_name,
            publisherType: 'operator',
            operatorProfileId: profile.id,
            idempotencyKey: `operator-import:${idempotencyKey}:${index}`,
            publicWebUrl: config.publicWebUrl,
            input: item
          });
          importedCount += 1;
        }
        await client.query(`
          UPDATE operator_import SET status='completed', succeeded_count=$2, completed_at=now() WHERE id=$1
        `, [existing.id, importedCount]);
        await client.query(`
          INSERT INTO audit_event (actor_user_id, action, resource_type, resource_id, metadata)
          VALUES ($1,'operator_import.completed','operator_import',$2,$3::jsonb)
        `, [request.user.sub, existing.id, JSON.stringify({ count: importedCount, format: input.data.format })]);
        return { importId: existing.id, importedCount, replayed: false };
      });
      return reply.code(result.replayed ? 200 : 201).send(result);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: { code: 'import_conflict', message: 'The import key conflicts with existing data' } });
      }
      throw error;
    }
  });

  app.post('/v1/inquiries', { preHandler: authenticate }, async (request, reply) => {
    const input = inquiryInputSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { code: 'invalid_request', details: input.error.flatten() } });
    const target = await query<{ id: string; publisher_user_id: string }>(`
      SELECT pub.id, pub.publisher_user_id
      FROM publication pub
      WHERE pub.property_id=$1 AND pub.publication_status='active'
        AND pub.publisher_user_id IS NOT NULL
        AND ($2::uuid IS NULL OR pub.id=$2)
      ORDER BY CASE pub.publisher_type WHEN 'owner' THEN 0 ELSE 1 END,
        pub.last_verified_at DESC NULLS LAST
      LIMIT 1
    `, [input.data.propertyId, input.data.publicationId ?? null]);
    const publication = target.rows[0];
    if (!publication) return reply.code(422).send({ error: { code: 'no_direct_recipient', message: 'No verified publisher can receive this inquiry' } });
    if (publication.publisher_user_id === request.user.sub) {
      return reply.code(409).send({ error: { code: 'self_inquiry', message: 'You cannot send an inquiry to your own publication' } });
    }
    const inserted = await query<InquiryRow>(`
      INSERT INTO inquiry (property_id, publication_id, sender_user_id, recipient_user_id, message)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [input.data.propertyId, publication.id, request.user.sub, publication.publisher_user_id, input.data.message]);
    return reply.code(201).send(inquiryDto(inserted.rows[0]!));
  });

  app.get('/v1/inquiries', { preHandler: authenticate }, async (request) => {
    const result = await query<InquiryRow>(`
      SELECT * FROM inquiry WHERE recipient_user_id=$1 ORDER BY created_at DESC LIMIT 200
    `, [request.user.sub]);
    return { items: result.rows.map(inquiryDto) };
  });

  app.patch('/v1/inquiries/:id', { preHandler: authenticate }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const input = inquiryUpdateSchema.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ error: { code: 'invalid_request' } });
    const updated = await query<InquiryRow>(`
      UPDATE inquiry SET status=$3 WHERE id=$1 AND recipient_user_id=$2 RETURNING *
    `, [params.data.id, request.user.sub, input.data.status]);
    if (!updated.rows[0]) return reply.code(404).send({ error: { code: 'not_found', message: 'Inquiry was not found' } });
    return inquiryDto(updated.rows[0]);
  });
}
