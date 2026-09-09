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
      JWT_SECRET: 'a-production-secret-that-is-at-least-thirty-two-characters'
    });
    assert.equal(config.environment, 'production');
  });

  it('requires an API key only when the OpenAI provider is selected', () => {
    assert.throws(() => loadApiConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-production-secret-that-is-at-least-thirty-two-characters',
      AI_PROVIDER: 'openai'
    }), /OPENAI_API_KEY/);
    const config = loadApiConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-production-secret-that-is-at-least-thirty-two-characters',
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
