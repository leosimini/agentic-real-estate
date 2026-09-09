import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accountTokenId, createAccountToken, hashAccountToken, verifyAccountToken } from '../src/account-tokens.js';

const parts = {
  id: '00000000-0000-4000-8000-000000000123',
  userId: '00000000-0000-4000-8000-000000000456',
  purpose: 'verify_email' as const
};

describe('account tokens', () => {
  it('creates a deterministic signed token whose plaintext need not be stored', () => {
    const token = createAccountToken(parts, 'a-secret-with-more-than-thirty-two-characters');
    assert.equal(accountTokenId(token), parts.id);
    assert.equal(verifyAccountToken(token, parts, 'a-secret-with-more-than-thirty-two-characters'), true);
    assert.match(hashAccountToken(token), /^[0-9a-f]{64}$/);
  });

  it('rejects altered tokens, context, and malformed identifiers', () => {
    const token = createAccountToken(parts, 'a-secret-with-more-than-thirty-two-characters');
    assert.equal(verifyAccountToken(`${token}x`, parts, 'a-secret-with-more-than-thirty-two-characters'), false);
    assert.equal(verifyAccountToken(token, { ...parts, purpose: 'reset_password' }, 'a-secret-with-more-than-thirty-two-characters'), false);
    assert.equal(accountTokenId('not-a-token'), null);
  });
});
