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

import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from '../db.ts';

export type TokenPurpose = 'confirm_email' | 'reset_password' | 'change_email';

const HOUR_MS = 60 * 60 * 1000;
const LIFETIME_MS: Record<TokenPurpose, number> = {
  confirm_email: 72 * HOUR_MS,
  change_email: 72 * HOUR_MS,
  reset_password: HOUR_MS,
};

export interface TokenInfo { id: number; userId: string; data: string | null }

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Creates a one-time token for the user and returns the secret part, which goes into the emailed link.
 * Earlier unused tokens of the same purpose stop working, so only the newest email is valid.
 */
export async function createToken(pool: Pool, userId: string, purpose: TokenPurpose, data?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(`DELETE FROM user_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
  await pool.query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, data, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [userId, purpose, sha256(token), data ?? null, LIFETIME_MS[purpose] / 1000],
  );
  return token;
}

/** Is the token valid (right purpose, unused, not expired)? Does not use it up. */
export async function peekToken(pool: Pool, token: string, purpose: TokenPurpose): Promise<TokenInfo | null> {
  const { rows } = await pool.query<{ id: string; user_id: string; data: string | null }>(
    `SELECT id, user_id, data FROM user_tokens
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()`,
    [sha256(token), purpose],
  );
  return rows[0] ? { id: Number(rows[0].id), userId: rows[0].user_id, data: rows[0].data } : null;
}

/** Uses the token up. Returns null if it is invalid, expired or was already used (also under concurrent calls). */
export async function consumeToken(pool: Pool, token: string, purpose: TokenPurpose): Promise<TokenInfo | null> {
  const { rows } = await pool.query<{ id: string; user_id: string; data: string | null }>(
    `UPDATE user_tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING id, user_id, data`,
    [sha256(token), purpose],
  );
  return rows[0] ? { id: Number(rows[0].id), userId: rows[0].user_id, data: rows[0].data } : null;
}

/** Housekeeping: drops tokens that are long expired or used. */
export async function purgeTokens(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM user_tokens WHERE expires_at < now() - interval '7 days' OR used_at < now() - interval '7 days'`);
}
