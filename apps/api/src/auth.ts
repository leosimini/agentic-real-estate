import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { query } from '@realty/db';

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export type Principal = {
  sub: string;
  email: string;
  role: 'consumer' | 'owner' | 'operator' | 'admin';
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Principal;
    user: Principal;
  }
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, keyLength) as Buffer;
  return { hash: derived.toString('base64url'), salt };
}

export async function verifyPassword(password: string, expectedHash: string, salt: string): Promise<boolean> {
  const derived = await scrypt(password, salt, keyLength) as Buffer;
  const expected = Buffer.from(expectedHash, 'base64url');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

const dummyCredential = hashPassword('fixed non-user credential for timing normalization');

export async function passwordCredentialOrDummy(
  credential: { password_hash: string; password_salt: string } | undefined
): Promise<{ hash: string; salt: string }> {
  if (credential) return { hash: credential.password_hash, salt: credential.password_salt };
  return dummyCredential;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const current = await query<{ email: string; role: Principal['role'] }>(
      'SELECT email, role FROM app_user WHERE id = $1',
      [request.user.sub]
    );
    const user = current.rows[0];
    if (!user) throw new Error('Account is not active');
    request.user.email = user.email;
    request.user.role = user.role;
  } catch {
    return reply.code(401).send({
      error: { code: 'unauthorized', message: 'A valid bearer token is required' }
    });
  }
}
