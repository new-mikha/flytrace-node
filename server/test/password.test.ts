import { describe, expect, it } from 'vitest';
import { hashPassword, verifyLegacyPassword, verifyPassword } from '../src/auth/password.ts';

// Fixture produced by an independent Python implementation of SqlMembershipProvider's
// format-1 encoding: base64(sha1(base64decode(salt) + password.encode('utf-16-le'))).
const SALT = 'LwKBbxGOnPud0PqiheeXkA==';
const HASH = 'sk6CmI9IAI5kYPkGhFQKHTBHBqQ=';
const LEGACY = `flytrace1|${HASH}|1|${SALT}`;

describe('legacy ASP.NET membership hashes', () => {
  it('accepts the right password', () => {
    expect(verifyLegacyPassword(LEGACY, 'correct horse')).toBe(true);
  });
  it('rejects wrong passwords and malformed hashes', () => {
    expect(verifyLegacyPassword(LEGACY, 'Correct horse')).toBe(false);
    expect(verifyLegacyPassword(LEGACY, '')).toBe(false);
    expect(verifyLegacyPassword('flytrace1|x|1', 'a')).toBe(false);
    expect(verifyLegacyPassword(`flytrace1|${HASH}|2|${SALT}`, 'correct horse')).toBe(false); // encrypted format unsupported
  });
  it('handles clear-text format 0', () => {
    expect(verifyLegacyPassword('flytrace1|secret|0|', 'secret')).toBe(true);
    expect(verifyLegacyPassword('flytrace1|secret|0|', 'nope')).toBe(false);
  });
  it('flags legacy hashes for rehash', async () => {
    expect(await verifyPassword(LEGACY, 'correct horse')).toEqual({ ok: true, needsRehash: true });
  });
});

describe('argon2 hashes', () => {
  it('round-trips and does not need rehash', async () => {
    const hash = await hashPassword('pa55word');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'pa55word')).toEqual({ ok: true, needsRehash: false });
    expect(await verifyPassword(hash, 'pa55word!')).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPassword('garbage', 'pa55word')).toEqual({ ok: false, needsRehash: false });
  });
});
