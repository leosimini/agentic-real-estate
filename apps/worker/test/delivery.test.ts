import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebhookEmailAdapter } from '../src/delivery.js';

describe('webhook email adapter', () => {
  it('passes a stable idempotency key and provider authentication', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const adapter = new WebhookEmailAdapter(
      'https://email.example.test/send',
      'provider-token',
      async (url, init) => {
        request = { url: String(url), init: init ?? {} };
        return new Response(JSON.stringify({ messageId: 'message-1' }), {
          status: 202, headers: { 'content-type': 'application/json' }
        });
      }
    );
    const result = await adapter.send({
      to: 'person@example.test', subject: 'Subject', text: 'Body', idempotencyKey: 'delivery-key'
    });
    assert.equal(result.messageId, 'message-1');
    assert.equal(request?.url, 'https://email.example.test/send');
    assert.equal(new Headers(request?.init.headers).get('idempotency-key'), 'delivery-key');
    assert.equal(new Headers(request?.init.headers).get('authorization'), 'Bearer provider-token');
  });

  it('treats non-success responses as retryable failures', async () => {
    const adapter = new WebhookEmailAdapter(
      'https://email.example.test/send', undefined,
      async () => new Response('', { status: 503 })
    );
    await assert.rejects(() => adapter.send({
      to: 'person@example.test', subject: 'Subject', text: 'Body', idempotencyKey: 'delivery-key'
    }), /HTTP 503/);
  });
});
