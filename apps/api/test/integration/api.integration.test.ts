import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { query, withTransaction } from '@realty/db';
import { createAccountToken } from '@realty/core';
import { buildApp } from '../../src/app.js';
import { loadApiConfig } from '../../src/config.js';

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration('API and PostgreSQL integration', () => {
  it('supports tenant-safe auth, idempotent publishing, search, saved state, and monitors', async () => {
    const app = await buildApp(loadApiConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'integration-test-secret-with-at-least-thirty-two-characters',
      PUBLIC_WEB_URL: 'http://localhost:3000'
    }));
    const suffix = randomUUID();
    const email = `owner-${suffix}@example.test`;
    const secondEmail = `consumer-${suffix}@example.test`;
    let userId = '';
    let secondUserId = '';
    let publicationId = '';
    let propertyId = '';
    let sourceListingId = '';

    try {
      const registration = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email, password: 'correct horse battery staple', displayName: 'Test Owner' }
      });
      assert.equal(registration.statusCode, 201);
      const registrationBody = registration.json();
      userId = registrationBody.user.id;
      const token = registrationBody.token as string;

      const duplicate = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email, password: 'correct horse battery staple' }
      });
      assert.equal(duplicate.statusCode, 409);

      const unauthenticated = await app.inject({ method: 'GET', url: '/v1/monitors' });
      assert.equal(unauthenticated.statusCode, 401);

      const publicationPayload = {
        address: `Integration Test Street ${suffix}, Unit A`,
        operation: 'sale',
        price: 240_000,
        currency: 'usd',
        rooms: 3,
        bedrooms: 2,
        areaTotalM2: 82
      };
      const publication = await app.inject({
        method: 'POST',
        url: '/v1/publications',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': `publish-${suffix}` },
        payload: publicationPayload
      });
      assert.equal(publication.statusCode, 201, publication.body);
      const publicationBody = publication.json();
      publicationId = publicationBody.publicationId;
      propertyId = publicationBody.propertyId;
      sourceListingId = publicationBody.sourceListingId;

      const replay = await app.inject({
        method: 'POST',
        url: '/v1/publications',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': `publish-${suffix}` },
        payload: publicationPayload
      });
      assert.equal(replay.statusCode, 200, replay.body);
      assert.equal(replay.json().replayed, true);
      assert.equal(replay.json().publicationId, publicationId);
      assert.equal(replay.json().propertyId, propertyId);

      const conflictingReplay = await app.inject({
        method: 'POST',
        url: '/v1/publications',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': `publish-${suffix}` },
        payload: { ...publicationPayload, price: 230_000 }
      });
      assert.equal(conflictingReplay.statusCode, 409);
      assert.equal(conflictingReplay.json().error.code, 'idempotency_conflict');

      const search = await app.inject({
        method: 'GET',
        url: '/v1/opportunities?operation=sale&currency=USD&locations=Integration%20Test%20Street&maxPrice=250000'
      });
      assert.equal(search.statusCode, 200, search.body);
      assert.equal(search.json().items.some((item: { id: string }) => item.id === propertyId), true);

      const detail = await app.inject({ method: 'GET', url: `/v1/opportunities/${propertyId}` });
      assert.equal(detail.statusCode, 200, detail.body);
      assert.equal(detail.json().publications.length, 1);

      const answer = await app.inject({
        method: 'POST', url: `/v1/opportunities/${propertyId}/questions`,
        payload: { question: '¿Cuál es el precio por m²?' }
      });
      assert.equal(answer.statusCode, 200, answer.body);
      assert.match(answer.json().answer, /USD/);
      assert.equal(answer.json().evidence.length, 2);

      const saved = await app.inject({
        method: 'PUT',
        url: `/v1/opportunities/${propertyId}/saved`,
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(saved.statusCode, 204);

      const dismissed = await app.inject({
        method: 'PUT',
        url: `/v1/opportunities/${propertyId}/dismissed`,
        headers: { authorization: `Bearer ${token}` },
        payload: { reason: 'noise', note: 'Too close to an avenue' }
      });
      assert.equal(dismissed.statusCode, 204);

      const monitor = await app.inject({
        method: 'POST',
        url: '/v1/monitors',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'Belgrano search',
          intentText: 'Three rooms in Belgrano below USD 250k',
          criteria: { operation: 'sale', currency: 'USD', maxPrice: 250_000, rooms: 3 }
        }
      });
      assert.equal(monitor.statusCode, 201, monitor.body);
      const monitorBody = monitor.json();
      assert.equal(monitorBody.intentText, 'Three rooms in Belgrano below USD 250k');
      assert.equal(monitorBody.enabled, true);

      const pausedMonitor = await app.inject({
        method: 'PATCH',
        url: `/v1/monitors/${monitorBody.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { enabled: false }
      });
      assert.equal(pausedMonitor.statusCode, 200, pausedMonitor.body);
      assert.equal(pausedMonitor.json().enabled, false);

      const createdAlert = await query<{ id: string }>(`
        INSERT INTO alert (user_id, monitor_id, type, title, body)
        VALUES ($1,$2,'monitor_digest','Price changed','One relevant change') RETURNING id
      `, [userId, monitorBody.id]);
      const readAlert = await app.inject({
        method: 'PUT',
        url: `/v1/alerts/${createdAlert.rows[0]!.id}/read`,
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(readAlert.statusCode, 204, readAlert.body);

      const secondRegistration = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email: secondEmail, password: 'another secure test password' }
      });
      assert.equal(secondRegistration.statusCode, 201);
      secondUserId = secondRegistration.json().user.id;
      const secondToken = secondRegistration.json().token as string;
      const secondMonitors = await app.inject({
        method: 'GET',
        url: '/v1/monitors',
        headers: { authorization: `Bearer ${secondToken}` }
      });
      assert.equal(secondMonitors.statusCode, 200);
      assert.deepEqual(secondMonitors.json().items, []);
      const cannotReadAnotherUsersAlert = await app.inject({
        method: 'PUT',
        url: `/v1/alerts/${createdAlert.rows[0]!.id}/read`,
        headers: { authorization: `Bearer ${secondToken}` }
      });
      assert.equal(cannotReadAnotherUsersAlert.statusCode, 404);
    } finally {
      await withTransaction(async (client) => {
        if (publicationId) await client.query('DELETE FROM publication WHERE id = $1', [publicationId]);
        if (sourceListingId) await client.query('DELETE FROM publication_snapshot WHERE source_listing_id = $1', [sourceListingId]);
        if (propertyId) {
          await client.query(`
            DELETE FROM property p WHERE p.id = $1
              AND NOT EXISTS (SELECT 1 FROM publication pub WHERE pub.property_id = p.id)
          `, [propertyId]);
        }
        for (const id of [userId, secondUserId].filter(Boolean)) {
          await client.query('DELETE FROM audit_event WHERE actor_user_id = $1', [id]);
          await client.query('DELETE FROM app_user WHERE id = $1', [id]);
        }
      });
      await app.close();
    }
  });

  it('serializes canonical identity creation across users and idempotency keys', async () => {
    const app = await buildApp(loadApiConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'integration-test-secret-with-at-least-thirty-two-characters',
      PUBLIC_WEB_URL: 'http://localhost:3000'
    }));
    const suffix = randomUUID();
    const userIds: string[] = [];
    const publicationIds: string[] = [];
    const sourceListingIds: string[] = [];
    let propertyId = '';

    try {
      const registrations = await Promise.all([1, 2].map((index) => app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: `concurrent-${index}-${suffix}@example.test`,
          password: `secure concurrent password ${index}`
        }
      })));
      for (const response of registrations) assert.equal(response.statusCode, 201, response.body);
      const principals = registrations.map((response) => response.json());
      userIds.push(...principals.map((principal) => principal.user.id as string));

      const payload = {
        address: `Concurrency Street ${suffix}, Unit Z`,
        operation: 'sale',
        price: 180_000,
        currency: 'USD',
        rooms: 2,
        bedrooms: 1,
        areaTotalM2: 55
      };
      const publications = await Promise.all(principals.map((principal, index) => app.inject({
        method: 'POST',
        url: '/v1/publications',
        headers: {
          authorization: `Bearer ${principal.token}`,
          'idempotency-key': `concurrent-${index}-${suffix}`
        },
        payload
      })));
      for (const response of publications) assert.equal(response.statusCode, 201, response.body);
      const results = publications.map((response) => response.json());
      assert.equal(new Set(results.map((result) => result.propertyId)).size, 1);
      assert.equal(new Set(results.map((result) => result.publicationId)).size, 2);
      assert.equal(results.filter((result) => result.canonicalDecision === 'confirmed_existing').length, 1);
      propertyId = results[0].propertyId;
      publicationIds.push(...results.map((result) => result.publicationId));
      sourceListingIds.push(...results.map((result) => result.sourceListingId));

      const replay = await app.inject({
        method: 'POST',
        url: '/v1/publications',
        headers: {
          authorization: `Bearer ${principals[1].token}`,
          'idempotency-key': `concurrent-1-${suffix}`
        },
        payload
      });
      assert.equal(replay.statusCode, 200, replay.body);
      assert.equal(replay.json().canonicalDecision, results[1].canonicalDecision);
    } finally {
      await withTransaction(async (client) => {
        if (publicationIds.length) await client.query('DELETE FROM publication WHERE id = ANY($1::uuid[])', [publicationIds]);
        if (sourceListingIds.length) {
          await client.query('DELETE FROM publication_snapshot WHERE source_listing_id = ANY($1::text[])', [sourceListingIds]);
        }
        if (propertyId) await client.query('DELETE FROM property WHERE id = $1', [propertyId]);
        for (const id of userIds) {
          await client.query('DELETE FROM audit_event WHERE actor_user_id = $1', [id]);
          await client.query('DELETE FROM app_user WHERE id = $1', [id]);
        }
      });
      await app.close();
    }
  });

  it('verifies email, resets a password, and revokes existing sessions', async () => {
    const accountTokenSecret = 'integration-account-token-secret-with-at-least-thirty-two-characters';
    const app = await buildApp(loadApiConfig({
      NODE_ENV: 'test',
      JWT_SECRET: 'integration-test-secret-with-at-least-thirty-two-characters',
      ACCOUNT_TOKEN_SECRET: accountTokenSecret
    }));
    const email = `account-${randomUUID()}@example.test`;
    let userId = '';
    try {
      const registration = await app.inject({
        method: 'POST', url: '/v1/auth/register',
        payload: { email, password: 'original secure password' }
      });
      assert.equal(registration.statusCode, 201, registration.body);
      userId = registration.json().user.id;
      const oldToken = registration.json().token as string;
      const verification = await query<{ id: string; user_id: string; purpose: 'verify_email' }>(`
        SELECT id, user_id, purpose FROM account_token
        WHERE user_id=$1 AND purpose='verify_email' AND consumed_at IS NULL
      `, [userId]);
      const verificationRow = verification.rows[0]!;
      const verificationToken = createAccountToken({
        id: verificationRow.id, userId: verificationRow.user_id, purpose: verificationRow.purpose
      }, accountTokenSecret);
      const confirmed = await app.inject({
        method: 'POST', url: '/v1/auth/verification/confirm',
        payload: { token: verificationToken }
      });
      assert.equal(confirmed.statusCode, 200, confirmed.body);

      const recovery = await app.inject({
        method: 'POST', url: '/v1/auth/password/request', payload: { email }
      });
      assert.equal(recovery.statusCode, 202, recovery.body);
      const reset = await query<{ id: string; user_id: string; purpose: 'reset_password' }>(`
        SELECT id, user_id, purpose FROM account_token
        WHERE user_id=$1 AND purpose='reset_password' AND consumed_at IS NULL
      `, [userId]);
      const resetRow = reset.rows[0]!;
      const resetToken = createAccountToken({
        id: resetRow.id, userId: resetRow.user_id, purpose: resetRow.purpose
      }, accountTokenSecret);
      const changed = await app.inject({
        method: 'POST', url: '/v1/auth/password/reset',
        payload: { token: resetToken, password: 'new secure password value' }
      });
      assert.equal(changed.statusCode, 200, changed.body);

      const revoked = await app.inject({
        method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${oldToken}` }
      });
      assert.equal(revoked.statusCode, 401);
      const oldLogin = await app.inject({
        method: 'POST', url: '/v1/auth/login', payload: { email, password: 'original secure password' }
      });
      assert.equal(oldLogin.statusCode, 401);
      const newLogin = await app.inject({
        method: 'POST', url: '/v1/auth/login', payload: { email, password: 'new secure password value' }
      });
      assert.equal(newLogin.statusCode, 200, newLogin.body);
      assert.equal(newLogin.json().user.emailVerified, true);
    } finally {
      if (userId) {
        await query('DELETE FROM audit_event WHERE actor_user_id=$1', [userId]);
        await query('DELETE FROM app_user WHERE id=$1', [userId]);
      }
      await app.close();
    }
  });
});
