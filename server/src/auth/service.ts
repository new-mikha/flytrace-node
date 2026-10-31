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

import type { Pool } from '../db.ts';
import { hashPassword, verifyPassword } from './password.ts';

// Valid argon2id hash (created on first use, same parameters as real hashes) that unknown login names are checked against.
let dummyHash: Promise<string> | undefined;

export interface CurrentUser {
  id: string;
  username: string;
  roles: string[];
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  is_approved: boolean;
  is_locked_out: boolean;
  email: string | null;
  email_confirmed: boolean;
  two_factor_enabled: boolean;
}

/** Outcome of checking a login name and password. */
export type LoginResult =
  | { kind: 'ok'; user: CurrentUser }
  /** Password is right, but a second step (authenticator code) is still needed. */
  | { kind: 'two-factor'; userId: string }
  /** Password is right, but the email address has not been confirmed and the site requires that. */
  | { kind: 'email-unconfirmed'; userId: string }
  | { kind: 'invalid' };

export async function loadUser(pool: Pool, id: string): Promise<CurrentUser | null> {
  const { rows } = await pool.query<{ id: string; username: string; roles: string[] }>(
    `SELECT u.id, u.username,
            COALESCE(array_agg(r.name::text) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 AND u.is_approved AND NOT u.is_locked_out
     GROUP BY u.id`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * `login` is a username or an email address (both are unique and case-insensitive); a username match wins.
 * 'invalid' covers every other failure (unknown user, wrong password, not approved, locked out), so callers cannot
 * tell them apart. This only checks the password: for 'two-factor' the caller asks for the code and then calls
 * `completeLogin`.
 */
export async function checkPassword(
  pool: Pool,
  login: string,
  password: string,
  requireConfirmedEmail = false,
): Promise<LoginResult> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, username, password_hash, is_approved, is_locked_out, email, email_confirmed, two_factor_enabled FROM users
     WHERE username = $1 OR email = $1
     ORDER BY (username = $1) DESC LIMIT 1`,
    [login],
  );
  const user = rows[0];
  if (!user) {
    // Unknown login name: still do a full password verification and discard the result. Without it this path
    // returns in about a millisecond while a wrong password costs an argon2 check (tens of ms), and that timing
    // gap would reveal which usernames and emails exist. Legacy SHA1 accounts remain fast until their first
    // login upgrades them to argon2id.
    await verifyPassword(await (dummyHash ??= hashPassword('dummy password')), password);
    return { kind: 'invalid' };
  }

  const { ok, needsRehash } = await verifyPassword(user.password_hash, password);
  if (!ok || !user.is_approved || user.is_locked_out) return { kind: 'invalid' };

  if (needsRehash)
    // Upgrade the legacy ASP.NET hash now that we have the plain password in hand.
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
      user.id,
      await hashPassword(password),
    ]);

  if (requireConfirmedEmail && !user.email_confirmed)
    return { kind: 'email-unconfirmed', userId: user.id };
  if (user.two_factor_enabled) return { kind: 'two-factor', userId: user.id };
  return completeLogin(pool, user.id);
}

/** Final step of a login (password, and the code if needed, are already checked): stamps the login time. */
export async function completeLogin(pool: Pool, userId: string): Promise<LoginResult> {
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  const user = await loadUser(pool, userId);
  return user ? { kind: 'ok', user } : { kind: 'invalid' };
}

/** Password-only check for callers that cannot do a second step: accounts with two-factor login never pass. */
export async function authenticate(
  pool: Pool,
  login: string,
  password: string,
): Promise<CurrentUser | null> {
  const result = await checkPassword(pool, login, password);
  return result.kind === 'ok' ? result.user : null;
}
