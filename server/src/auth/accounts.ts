import { z } from 'zod';
import type { Pool } from '../db.ts';
import { hashPassword, verifyPassword } from './password.ts';

// ---- input rules ----

// No '@' in usernames: a username must never look like (or equal) somebody's email, because both are login names.
export const usernameSchema = z.string().trim()
  .regex(/^[A-Za-z0-9._-]{3,64}$/, 'Use 3 to 64 letters, digits, dots, dashes or underscores.');
export const emailSchema = z.string().trim().max(256).pipe(z.email('Enter a valid email address.'));
export const MIN_PASSWORD_LENGTH = 6;
export const newPasswordSchema = z.string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`).max(128, 'Use at most 128 characters.');

export function isUniqueViolation(err: unknown): err is { code: string; constraint?: string } {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export interface Account {
  id: string;
  username: string;
  email: string | null;
  emailConfirmed: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export async function getAccount(pool: Pool, userId: string): Promise<Account | null> {
  const { rows } = await pool.query<{
    id: string; username: string; email: string | null; email_confirmed: boolean; two_factor_enabled: boolean;
    created_at: Date; last_login_at: Date | null;
  }>(
    `SELECT id, username, email, email_confirmed, two_factor_enabled, created_at, last_login_at FROM users WHERE id = $1`,
    [userId]);
  const r = rows[0];
  return !r ? null : {
    id: r.id, username: r.username, email: r.email, emailConfirmed: r.email_confirmed,
    twoFactorEnabled: r.two_factor_enabled, createdAt: r.created_at, lastLoginAt: r.last_login_at,
  };
}

export async function findByLogin(pool: Pool, login: string): Promise<{ id: string; username: string; email: string | null; emailConfirmed: boolean } | null> {
  const { rows } = await pool.query<{ id: string; username: string; email: string | null; email_confirmed: boolean }>(
    `SELECT id, username, email, email_confirmed FROM users
     WHERE (username = $1 OR email = $1) AND is_approved AND NOT is_locked_out
     ORDER BY (username = $1) DESC LIMIT 1`,
    [login]);
  const r = rows[0];
  return r ? { id: r.id, username: r.username, email: r.email, emailConfirmed: r.email_confirmed } : null;
}

// ---- registration ----

export type RegisterResult =
  | { ok: true; userId: string }
  | { ok: false; field: 'username' | 'email'; message: string };

/** A new address must not equal anybody's username either (both are login names). */
export async function emailTaken(pool: Pool, email: string, exceptUserId?: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM users WHERE (email = $1 OR username = $1) AND ($2::uuid IS NULL OR id <> $2)`,
    [email, exceptUserId ?? null]);
  return (rowCount ?? 0) > 0;
}

export async function registerUser(pool: Pool, input: { username: string; email: string; password: string }): Promise<RegisterResult> {
  const taken: RegisterResult = { ok: false, field: 'email', message: 'This email address is already registered.' };
  const nameTaken: RegisterResult = { ok: false, field: 'username', message: 'This username is taken.' };
  if (await emailTaken(pool, input.email)) return taken;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (username, email, password_hash, email_confirmed) VALUES ($1, $2, $3, false) RETURNING id`,
      [input.username, input.email, await hashPassword(input.password)]);
    await pool.query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0]!.id]);
    return { ok: true, userId: rows[0]!.id };
  } catch (err) {
    if (isUniqueViolation(err)) return err.constraint?.includes('email') ? taken : nameTaken;
    throw err;
  }
}

export async function isUsernameTaken(pool: Pool, username: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
  return (rowCount ?? 0) > 0;
}

// ---- email ----

export async function confirmEmail(pool: Pool, userId: string): Promise<void> {
  await pool.query('UPDATE users SET email_confirmed = true WHERE id = $1', [userId]);
}

/** Sets a new, already confirmed address. False if somebody else has it by now. */
export async function changeEmail(pool: Pool, userId: string, email: string): Promise<boolean> {
  if (await emailTaken(pool, email, userId)) return false;
  try {
    await pool.query('UPDATE users SET email = $2, email_confirmed = true WHERE id = $1', [userId, email]);
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

export async function canUseEmail(pool: Pool, email: string, userId: string): Promise<boolean> {
  return !(await emailTaken(pool, email, userId));
}

// ---- password ----

export async function checkCurrentPassword(pool: Pool, userId: string, password: string): Promise<boolean> {
  const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const hash = rows[0]?.password_hash;
  return hash ? (await verifyPassword(hash, password)).ok : false;
}

/** Ends every login session of the user except `keepSessionId` (the one that just changed the password). */
export async function endSessions(pool: Pool, userId: string, keepSessionId?: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)`,
    [userId, keepSessionId ?? null]);
}

export async function setPassword(pool: Pool, userId: string, password: string, keepSessionId?: string): Promise<void> {
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await hashPassword(password)]);
  await endSessions(pool, userId, keepSessionId);
}

// ---- two-factor ----

export async function enableTwoFactor(pool: Pool, userId: string, secret: string, usedStep: number): Promise<void> {
  await pool.query(
    `UPDATE users SET two_factor_enabled = true, two_factor_secret = $2, two_factor_last_used_step = $3 WHERE id = $1`,
    [userId, secret, usedStep]);
}

export async function disableTwoFactor(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL, two_factor_last_used_step = NULL WHERE id = $1`,
    [userId]);
  await pool.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
}

// ---- delete / export ----

export async function deleteAccount(pool: Pool, userId: string): Promise<void> {
  await endSessions(pool, userId);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]); // cascades to groups, trackers, roles, tokens, ...
}

/** Everything we hold about the user that is theirs to take away (never the password hash or 2FA secret). */
export async function exportPersonalData(pool: Pool, userId: string): Promise<object | null> {
  const account = await getAccount(pool, userId);
  if (!account) return null;
  const [roles, profile, events, groups] = await Promise.all([
    pool.query('SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name', [userId]),
    pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM events WHERE user_id = $1 ORDER BY id', [userId]),
    pool.query(
      `SELECT g.*, COALESCE((SELECT json_agg(t ORDER BY t.id) FROM group_trackers t WHERE t.group_id = g.id), '[]'::json) AS trackers
       FROM groups g WHERE g.user_id = $1 ORDER BY g.id`, [userId]),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: {
      username: account.username, email: account.email, emailConfirmed: account.emailConfirmed,
      twoFactorEnabled: account.twoFactorEnabled, createdAt: account.createdAt, lastLoginAt: account.lastLoginAt,
    },
    roles: roles.rows.map((r: { name: string }) => r.name),
    profile: profile.rows[0] ?? null,
    events: events.rows,
    groups: groups.rows,
  };
}
