import { randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import type { Pool } from '../db.ts';
import { sha256 } from './tokens.ts';

const STEP_SECONDS = 30;
const RECOVERY_CODE_COUNT = 10;
// No 0/O/1/I/L, so a code copied from paper cannot be misread.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function totp(secret: string, issuer: string, account: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer, label: account, algorithm: 'SHA1', digits: 6, period: STEP_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function newSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function provisioningUri(secret: string, issuer: string, account: string): string {
  return totp(secret, issuer, account).toString();
}

/** Inline SVG of the QR code for the authenticator app. */
export function qrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

/** Strips spaces and dashes users type between the digits. */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '');
}

/**
 * Checks a 6-digit code against the secret, allowing one step of clock drift either way.
 * Returns the time step of the code (so it can be remembered and refused a second time) or null.
 */
export function checkCode(secret: string, code: string, now = Date.now()): number | null {
  const digits = normalizeCode(code);
  if (!/^\d{6}$/.test(digits)) return null;
  const delta = totp(secret, 'Flytrace', 'check').validate({ token: digits, timestamp: now, window: 1 });
  if (delta === null) return null;
  return Math.floor(now / 1000 / STEP_SECONDS) + delta;
}

/** Verifies the code for the user and records its time step; false for a wrong or already used code. */
export async function verifyUserCode(pool: Pool, userId: string, code: string): Promise<boolean> {
  const { rows } = await pool.query<{ two_factor_secret: string | null }>(
    'SELECT two_factor_secret FROM users WHERE id = $1 AND two_factor_enabled', [userId]);
  const secret = rows[0]?.two_factor_secret;
  if (!secret) return false;
  const step = checkCode(secret, code);
  if (step === null) return false;
  const { rowCount } = await pool.query(
    `UPDATE users SET two_factor_last_used_step = $2
     WHERE id = $1 AND (two_factor_last_used_step IS NULL OR two_factor_last_used_step < $2)`,
    [userId, step]);
  return rowCount === 1;
}

function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Replaces the user's recovery codes with a fresh set; returns the plain codes, shown to the user once. */
export async function replaceRecoveryCodes(pool: Pool, userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await pool.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
  await pool.query(
    `INSERT INTO recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`,
    [userId, codes.map((c) => sha256(normalizeRecoveryCode(c)))],
  );
  return codes;
}

/** Uses up one recovery code; false if it is wrong or was used before. */
export async function useRecoveryCode(pool: Pool, userId: string, code: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [userId, sha256(normalizeRecoveryCode(code))]);
  return rowCount === 1;
}

export async function countRecoveryCodes(pool: Pool, userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  return Number(rows[0]?.n ?? 0);
}
