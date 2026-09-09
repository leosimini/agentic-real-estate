import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { query, withTransaction } from '@realty/db';
import { buildApp } from '../../src/app.js';
import { loadApiConfig } from '../../src/config.js';

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration('operator supply and inquiry integration', () => {
  it('preserves aggregate provenance through verified claims, imports, management, and inquiries', async () => {
    const app = await buildApp(loadApiConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'integration-test-secret-with-at-least-thirty-two-characters',
      PUBLIC_WEB_URL: 'http://localhost:3000'
    }));
    const suffix = randomUUID();
    const userIds: string[] = [];
    const propertyIds: string[] = [];
    const snapshotListingIds: string[] = [];

    async function register(label: string) {
      const response = await app.inject({
        method: 'POST', url: '/v1/auth/register',
        payload: { email: `${label}-${suffix}@example.test`, password: `secure ${label} password 2026` }
      });
      assert.equal(response.statusCode, 201, response.body);
      const body = response.json();
      userIds.push(body.user.id);
      return { id: body.user.id as string, token: body.token as string };
    }

    try {
      const operator = await register('operator');
      const consumer = await register('consumer');
      const outsider = await register('outsider');
      const admin = await register('admin');
      await query(`UPDATE app_user SET role='admin' WHERE id=$1`, [admin.id]);

      const profileResponse = await app.inject({
        method: 'POST', url: '/v1/operators/profile',
        headers: { authorization: `Bearer ${operator.token}` },
        payload: { displayName: 'Inmobiliaria Verificada', licenseNumber: 'CPI 1234' }
      });
      assert.equal(profileResponse.statusCode, 201, profileResponse.body);
      const profile = profileResponse.json();
      assert.equal(profile.verificationStatus, 'pending');

      const aggregated = await withTransaction(async (client) => {
        const property = await client.query<{ id: string }>(`
          INSERT INTO property (canonical_address, normalized_address, operation, currency, canonical_price, status)
          VALUES ($1,$2,'sale','USD',190000,'active') RETURNING id
        `, [`Aggregate ${suffix}, Palermo`, `aggregate ${suffix} palermo`]);
        const publication = await client.query<{ id: string }>(`
          INSERT INTO publication (
            source_id, source_listing_id, source_url, property_id, publisher_type,
            title, currency, price, publication_status
          ) SELECT id,$1,'https://example.invalid/listing/' || $1,$2,'aggregated','Aggregate listing','USD',190000,'active'
            FROM source WHERE code='demo' RETURNING id
        `, [`aggregate-${suffix}`, property.rows[0]!.id]);
        return { propertyId: property.rows[0]!.id, publicationId: publication.rows[0]!.id };
      });
      propertyIds.push(aggregated.propertyId);

      const pendingClaim = await app.inject({
        method: 'POST', url: '/v1/operators/claims',
        headers: { authorization: `Bearer ${operator.token}` },
        payload: { publicationId: aggregated.publicationId, evidence: { license: 'CPI 1234' } }
      });
      assert.equal(pendingClaim.statusCode, 403);

      await query(`UPDATE operator_profile SET verification_status='verified', verified_at=now() WHERE id=$1`, [profile.id]);
      const claimResponse = await app.inject({
        method: 'POST', url: '/v1/operators/claims',
        headers: { authorization: `Bearer ${operator.token}` },
        payload: { publicationId: aggregated.publicationId, evidence: { license: 'CPI 1234', authorization: 'signed mandate' } }
      });
      assert.equal(claimResponse.statusCode, 201, claimResponse.body);
      const claim = claimResponse.json();

      const forbiddenReview = await app.inject({
        method: 'PATCH', url: `/v1/admin/claims/${claim.id}`,
        headers: { authorization: `Bearer ${consumer.token}` }, payload: { status: 'approved' }
      });
      assert.equal(forbiddenReview.statusCode, 403);

      const approval = await app.inject({
        method: 'PATCH', url: `/v1/admin/claims/${claim.id}`,
        headers: { authorization: `Bearer ${admin.token}` }, payload: { status: 'approved' }
      });
      assert.equal(approval.statusCode, 200, approval.body);
      const provenance = await query<{ publisher_type: string; source_listing_id: string }>(`
        SELECT publisher_type, source_listing_id FROM publication WHERE property_id=$1 ORDER BY publisher_type
      `, [aggregated.propertyId]);
      assert.equal(provenance.rows.some((row) => row.publisher_type === 'aggregated' && row.source_listing_id === `aggregate-${suffix}`), true);
      assert.equal(provenance.rows.some((row) => row.publisher_type === 'operator' && row.source_listing_id === `claim-${claim.id}`), true);
      snapshotListingIds.push(`claim-${claim.id}`);

      const operatorPublication = await query<{ id: string }>(`
        SELECT operator_publication_id AS id FROM listing_claim WHERE id=$1
      `, [claim.id]);
      const inquiryResponse = await app.inject({
        method: 'POST', url: '/v1/inquiries',
        headers: { authorization: `Bearer ${consumer.token}` },
        payload: {
          propertyId: aggregated.propertyId,
          publicationId: operatorPublication.rows[0]!.id,
          message: 'Quisiera coordinar una visita durante esta semana.'
        }
      });
      assert.equal(inquiryResponse.statusCode, 201, inquiryResponse.body);
      assert.equal(inquiryResponse.json().recipientUserId, operator.id);
      const inbox = await app.inject({ method: 'GET', url: '/v1/inquiries', headers: { authorization: `Bearer ${operator.token}` } });
      assert.equal(inbox.statusCode, 200);
      assert.equal(inbox.json().items.some((item: { id: string }) => item.id === inquiryResponse.json().id), true);
      const outsiderInbox = await app.inject({ method: 'GET', url: '/v1/inquiries', headers: { authorization: `Bearer ${outsider.token}` } });
      assert.deepEqual(outsiderInbox.json().items, []);

      const importResponse = await app.inject({
        method: 'POST', url: '/v1/operators/imports',
        headers: { authorization: `Bearer ${operator.token}`, 'idempotency-key': `operator-import-${suffix}` },
        payload: {
          format: 'json', filename: 'inventory.json', items: [{
            address: `Import ${suffix}, Mendoza`, operation: 'rent', price: 850000,
            currency: 'ARS', propertyType: 'Departamento', rooms: 2
          }]
        }
      });
      assert.equal(importResponse.statusCode, 201, importResponse.body);
      assert.equal(importResponse.json().importedCount, 1);
      const importReplay = await app.inject({
        method: 'POST', url: '/v1/operators/imports',
        headers: { authorization: `Bearer ${operator.token}`, 'idempotency-key': `operator-import-${suffix}` },
        payload: {
          format: 'json', filename: 'inventory.json', items: [{
            address: `Import ${suffix}, Mendoza`, operation: 'rent', price: 850000,
            currency: 'ARS', propertyType: 'Departamento', rooms: 2
          }]
        }
      });
      assert.equal(importReplay.statusCode, 200, importReplay.body);
      assert.equal(importReplay.json().replayed, true);

      const mine = await app.inject({ method: 'GET', url: '/v1/publications/mine', headers: { authorization: `Bearer ${operator.token}` } });
      assert.equal(mine.statusCode, 200, mine.body);
      const imported = mine.json().items.find((item: { address?: string }) => item.address?.startsWith('Import'));
      assert.ok(imported);
      propertyIds.push(imported.propertyId);
      snapshotListingIds.push(imported.sourceListingId);

      const staleUpdate = await app.inject({
        method: 'PATCH', url: `/v1/publications/${imported.id}`,
        headers: { authorization: `Bearer ${operator.token}`, 'if-match': '99' },
        payload: { price: 810000 }
      });
      assert.equal(staleUpdate.statusCode, 409, staleUpdate.body);
      const update = await app.inject({
        method: 'PATCH', url: `/v1/publications/${imported.id}`,
        headers: { authorization: `Bearer ${operator.token}`, 'if-match': String(imported.version) },
        payload: { price: 810000, declaredAvailability: 'available' }
      });
      assert.equal(update.statusCode, 200, update.body);
      assert.equal(update.json().price, 810000);
      assert.equal(update.json().version, imported.version + 1);
      const crossTenantUpdate = await app.inject({
        method: 'PATCH', url: `/v1/publications/${imported.id}`,
        headers: { authorization: `Bearer ${outsider.token}`, 'if-match': String(update.json().version) },
        payload: { status: 'removed' }
      });
      assert.equal(crossTenantUpdate.statusCode, 404);
    } finally {
      await withTransaction(async (client) => {
        if (propertyIds.length) await client.query('DELETE FROM publication WHERE property_id = ANY($1::uuid[])', [propertyIds]);
        if (snapshotListingIds.length) await client.query('DELETE FROM publication_snapshot WHERE source_listing_id = ANY($1::text[])', [snapshotListingIds]);
        if (propertyIds.length) await client.query('DELETE FROM property WHERE id = ANY($1::uuid[])', [propertyIds]);
        for (const id of userIds) {
          await client.query('DELETE FROM audit_event WHERE actor_user_id=$1 OR resource_id=$1::text', [id]);
          await client.query('DELETE FROM app_user WHERE id=$1', [id]);
        }
      });
      await app.close();
    }
  });
});
