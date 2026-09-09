import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { loadApiConfig } from '../src/config.js';
import { decodeCursor, encodeCursor } from '../src/pagination.js';

describe('authentication foundation', () => {
  it('hashes passwords with a random salt and verifies without exposing the password', async () => {
    const first = await hashPassword('a sufficiently long password');
    const second = await hashPassword('a sufficiently long password');

    assert.notEqual(first.hash, second.hash);
    assert.notEqual(first.salt, second.salt);
    assert.equal(await verifyPassword('a sufficiently long password', first.hash, first.salt), true);
    assert.equal(await verifyPassword('the wrong password', first.hash, first.salt), false);
  });

  it('requires an explicit JWT secret in production', () => {
    assert.throws(() => loadApiConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
    const config = loadApiConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-production-secret-that-is-at-least-thirty-two-characters',
      ACCOUNT_TOKEN_SECRET: 'a-distinct-account-token-secret-with-enough-entropy'
    });
    assert.equal(config.environment, 'production');
  });

  it('requires an API key only when the OpenAI provider is selected', () => {
    assert.throws(() => loadApiConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-production-secret-that-is-at-least-thirty-two-characters',
      ACCOUNT_TOKEN_SECRET: 'a-distinct-account-token-secret-with-enough-entropy',
      AI_PROVIDER: 'openai'
    }), /OPENAI_API_KEY/);
    const config = loadApiConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-production-secret-that-is-at-least-thirty-two-characters',
      ACCOUNT_TOKEN_SECRET: 'a-distinct-account-token-secret-with-enough-entropy',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'server-side-key'
    });
    assert.equal(config.aiProvider, 'openai');
  });

  it('protects user-scoped endpoints', async () => {
    const app = await buildApp(loadApiConfig({ NODE_ENV: 'test' }));
    const response = await app.inject({ method: 'GET', url: '/v1/me' });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'unauthorized');
    await app.close();
  });

  it('rejects unsafe cookie-authenticated requests from an unknown origin', async () => {
    const app = await buildApp(loadApiConfig({ NODE_ENV: 'test', CORS_ORIGINS: 'https://app.example.test' }));
    const rejected = await app.inject({
      method: 'POST', url: '/v1/auth/logout', headers: { cookie: 'umbral_session=placeholder' }
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.json().error.code, 'invalid_origin');
    const accepted = await app.inject({
      method: 'POST', url: '/v1/auth/logout',
      headers: { cookie: 'umbral_session=placeholder', origin: 'https://app.example.test' }
    });
    assert.equal(accepted.statusCode, 204);
    assert.match(String(accepted.headers['set-cookie']), /umbral_session=;/);
    await app.close();
  });

  it('rejects cross-origin account writes before a session exists', async () => {
    const app = await buildApp(loadApiConfig({ NODE_ENV: 'test', CORS_ORIGINS: 'https://app.example.test' }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: 'https://attacker.example.test' },
      payload: { email: 'person@example.test', password: 'password' }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'invalid_origin');
    await app.close();
  });

  it('interprets intent without requiring an account and requires confirmation', async () => {
    const app = await buildApp(loadApiConfig({ NODE_ENV: 'test' }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/intents/interpret',
      payload: { intent: 'Alquiler en Rosario hasta ARS 700.000' }
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().criteria, {
      operation: 'rent', locations: ['Rosario'], currency: 'ARS', maxPrice: 700000, preferences: []
    });
    assert.equal(response.json().requiresConfirmation, true);
    await app.close();
  });
});

describe('cursor pagination', () => {
  it('round-trips an opaque cursor and rejects malformed input', () => {
    const input = {
      updatedAt: '2026-09-09T12:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000001'
    };
    assert.deepEqual(decodeCursor(encodeCursor(input)), input);
    assert.throws(() => decodeCursor('not-a-cursor'), /Invalid pagination cursor/);
  });
});
