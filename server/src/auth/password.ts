import { createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

export const LEGACY_PREFIX = 'flytrace1|';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Verifies a password against a hash imported from the original ASP.NET site:
 * "flytrace1|<hash>|<format>|<salt>", where format 0 is clear text and format 1 is
 * SqlMembershipProvider's hashed format: base64(SHA1(saltBytes || UTF-16LE(password))).
 * Format 2 (encrypted with the machineKey) cannot be verified and always fails.
 */
export function verifyLegacyPassword(stored: string, password: string): boolean {
  const parts = stored.split('|');
  if (parts.length !== 4 || parts[0] !== 'flytrace1') return false;
  const [, hash = '', format = '', salt = ''] = parts;
  if (format === '0') return safeEqual(hash, password);
  if (format !== '1') return false;
  const computed = createHash('sha1')
    .update(Buffer.concat([Buffer.from(salt, 'base64'), Buffer.from(password, 'utf16le')]))
    .digest('base64');
  return safeEqual(computed, hash);
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export interface VerifyResult { ok: boolean; needsRehash: boolean }

export async function verifyPassword(stored: string, password: string): Promise<VerifyResult> {
  if (stored.startsWith(LEGACY_PREFIX)) {
    return { ok: verifyLegacyPassword(stored, password), needsRehash: true };
  }
  try {
    return { ok: await argon2.verify(stored, password), needsRehash: false };
  } catch {
    return { ok: false, needsRehash: false };
  }
}
