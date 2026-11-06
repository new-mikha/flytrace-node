///////////////////////////////////////////////////////////////////////////////
//  Flytrace, online viewer for GPS trackers.
//  Copyright (C) 2011-2026 Mikhail Karmazin
//
//  This file is part of Flytrace.
//
//  Flytrace is free software: you can redistribute it and/or modify
//  it under the terms of the GNU Affero General Public License as
//  published by the Free Software Foundation, either version 3 of the
//  License, or (at your option) any later version.
//
//  Flytrace is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  GNU Affero General Public License for more details.
//
//  You should have received a copy of the GNU Affero General Public License
//  along with Flytrace.  If not, see <http://www.gnu.org/licenses/>.
///////////////////////////////////////////////////////////////////////////////

import argon2 from 'argon2';
import { createHash, timingSafeEqual } from 'node:crypto';

export const LEGACY_PREFIX = 'flytrace1|';
/** "flytrace2|<salt>|<argon2id of the SHA-1 bytes>": see `wrapLegacyHash`. */
export const WRAPPED_PREFIX = 'flytrace2|';

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
  return safeEqual(legacySha1(salt, password).toString('base64'), hash);
}

function legacySha1(salt: string, password: string): Buffer {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(salt, 'base64'), Buffer.from(password, 'utf16le')]))
    .digest();
}

/**
 * Puts argon2id around a legacy SHA-1, for the accounts that have not logged in since the import:
 * the password is not known, but the hash can be hashed, so that a stolen database no longer gives
 * fast guesses. The first login then replaces it with a plain argon2id hash of the password.
 */
export async function wrapLegacyHash(stored: string): Promise<string> {
  const [prefix, hash, format, salt] = stored.split('|');
  if (`${prefix}|` !== LEGACY_PREFIX || format !== '1' || !hash || salt === undefined)
    throw new Error('Only a hashed legacy password can be wrapped');
  const wrapped = await argon2.hash(Buffer.from(hash, 'base64'), { type: argon2.argon2id });
  return `${WRAPPED_PREFIX}${salt}|${wrapped}`;
}

async function verifyWrappedPassword(stored: string, password: string): Promise<boolean> {
  const [, salt = '', wrapped = ''] = stored.split('|');
  try {
    return await argon2.verify(wrapped, legacySha1(salt, password));
  } catch {
    return false;
  }
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export interface VerifyResult {
  ok: boolean;
  needsRehash: boolean;
}

export async function verifyPassword(stored: string, password: string): Promise<VerifyResult> {
  if (stored.startsWith(LEGACY_PREFIX))
    return { ok: verifyLegacyPassword(stored, password), needsRehash: true };
  if (stored.startsWith(WRAPPED_PREFIX))
    return { ok: await verifyWrappedPassword(stored, password), needsRehash: true };
  try {
    return { ok: await argon2.verify(stored, password), needsRehash: false };
  } catch {
    return { ok: false, needsRehash: false };
  }
}
