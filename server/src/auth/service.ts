import type { Pool } from '../db.ts';
import { hashPassword, verifyPassword } from './password.ts';

// Valid argon2id hash (created on first use, same parameters as real hashes) that unknown login names are checked against.
let dummyHash: Promise<string> | undefined;

export interface CurrentUser { id: string; username: string; roles: string[] }

interface UserRow {
  id: string; username: string; password_hash: string; is_approved: boolean; is_locked_out: boolean;
}

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
 * Returns the user on success, null for any failure (unknown user, wrong password, not approved, locked out).
 */
export async function authenticate(pool: Pool, login: string, password: string): Promise<CurrentUser | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, username, password_hash, is_approved, is_locked_out FROM users
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
    return null;
  }

  const { ok, needsRehash } = await verifyPassword(user.password_hash, password);
  if (!ok || !user.is_approved || user.is_locked_out) return null;

  if (needsRehash) {
    // Upgrade the legacy ASP.NET hash now that we have the plain password in hand.
    await pool.query('UPDATE users SET password_hash = $2, last_login_at = now() WHERE id = $1',
      [user.id, await hashPassword(password)]);
  } else {
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  }
  return loadUser(pool, user.id);
}
