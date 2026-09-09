import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type AccountTokenPurpose = 'verify_email' | 'reset_password';

type AccountTokenParts = {
  id: string;
  userId: string;
  purpose: AccountTokenPurpose;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signature(parts: AccountTokenParts, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${parts.id}:${parts.userId}:${parts.purpose}`)
    .digest('base64url');
}

export function createAccountToken(parts: AccountTokenParts, secret: string): string {
  if (!uuidPattern.test(parts.id)) throw new Error('Account token id must be a UUID');
  return `${parts.id}.${signature(parts, secret)}`;
}

export function hashAccountToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verifyAccountToken(token: string, parts: AccountTokenParts, secret: string): boolean {
  const [id, supplied, extra] = token.split('.');
  if (extra !== undefined || id !== parts.id || !supplied) return false;
  const expected = signature(parts, secret);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function accountTokenId(token: string): string | null {
  const [id, supplied, extra] = token.split('.');
  return extra === undefined && supplied && id && uuidPattern.test(id) ? id : null;
}
