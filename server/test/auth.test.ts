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

// End-to-end auth and authorisation flow against the dev database (needs `npm run db:migrate`).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { authenticate } from '../src/auth/service.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const SALT = 'LwKBbxGOnPud0PqiheeXkA==';
const LEGACY_HASH = `flytrace1|sk6CmI9IAI5kYPkGhFQKHTBHBqQ=|1|${SALT}`; // password: "correct horse"
const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_user_${run}`;
const ADMIN = `__test_admin_${run}`;
const EMAIL = `__test_${run}@example.test`;

let app: FastifyInstance;
let pool: Pool;

/** Logs in through the HTML form; `ok` means it redirected to the page asked for, not back to /login. */
let ipCounter = 0;
async function login(username: string, password: string) {
  // own client IP per login, so the per-IP login rate limit does not trip over the many logins of these tests
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    remoteAddress: `10.2.0.${++ipCounter}`,
    payload: new URLSearchParams({ username, password, returnUrl: '/account' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid');
  return {
    res,
    ok: res.headers.location === '/account',
    cookies: cookie ? { [cookie.name]: cookie.value } : {},
  };
}

/** Name shown on the account page for these cookies, or null when not logged in. */
async function whoami(cookies: Record<string, string>): Promise<string | null> {
  const res = await app.inject({ url: '/account', cookies });
  return res.statusCode === 200
    ? (res.body.match(/Username<\/dt><dd[^>]*>([^<]+)</)?.[1] ?? null)
    : null;
}

beforeAll(async () => {
  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);
  await pool.query(
    `INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $4), ($3, $2, NULL)`,
    [USER, LEGACY_HASH, ADMIN, EMAIL],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id)
                    SELECT u.id, r.id FROM users u, roles r WHERE u.username = $1 AND r.name = 'Admins'`,
    [ADMIN],
  );
  await pool.query(
    `INSERT INTO groups (name, user_id) SELECT 'Test group ' || $2, id FROM users WHERE username = $1`,
    [USER, run],
  );
  app = await buildApp(config, pool);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username LIKE $1', [`__test_%_${run}`]);
  await app.close(); // also ends the pool
});

describe('anonymous', () => {
  it('sees the home page', async () => {
    expect((await app.inject({ url: '/' })).statusCode).toBe(200);
  });
  it('is redirected to login from protected pages', async () => {
    const res = await app.inject({ url: '/account/password' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?returnUrl=%2Faccount%2Fpassword');
    expect((await app.inject({ url: '/admin' })).statusCode).toBe(302);
    expect((await app.inject({ url: '/account' })).statusCode).toBe(302);
  });
});

describe('login', () => {
  it('rejects a wrong password and unknown users', async () => {
    expect((await login(USER, 'wrong')).ok).toBe(false);
    expect((await login('nobody_' + run, 'x')).ok).toBe(false);
    const empty = await app.inject({
      method: 'POST',
      url: '/login',
      payload: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(empty.headers.location).toContain('/login?error=');
  });

  it('accepts a legacy password and upgrades the hash', async () => {
    const { ok, cookies } = await login(USER, 'correct horse');
    expect(ok).toBe(true);
    expect(await whoami(cookies)).toBe(USER);
    const { rows } = await pool.query<{ password_hash: string; last_login_at: Date | null }>(
      'SELECT password_hash, last_login_at FROM users WHERE username = $1',
      [USER],
    );
    expect(rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(rows[0]?.last_login_at).not.toBeNull();
    // still works with the upgraded hash
    expect((await login(USER, 'correct horse')).ok).toBe(true);
  });

  it('accepts the email address as the login name, case-insensitively', async () => {
    const { ok, cookies } = await login(EMAIL.toUpperCase(), 'correct horse');
    expect(ok).toBe(true);
    expect(await whoami(cookies)).toBe(USER);
    expect((await login(EMAIL, 'wrong')).ok).toBe(false);
  });

  it('spends similar time on unknown names and wrong passwords (no user enumeration by timing)', async () => {
    const name = `__test_timing_${run}`;
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [
      name,
      await hashPassword('right'),
    ]);
    const time = async (login: string) => {
      const start = performance.now();
      expect(await authenticate(pool, login, 'wrong')).toBeNull();
      return performance.now() - start;
    };
    await time(name);
    await time('nobody_' + run); // warm up (connection, dummy hash)
    const known = Math.min(await time(name), await time(name), await time(name));
    const unknown = Math.min(
      await time('nobody_' + run),
      await time('nobody_' + run),
      await time('nobody_' + run),
    );
    expect(unknown).toBeGreaterThan(known * 0.5);
  });

  it('refuses locked-out users', async () => {
    await pool.query('UPDATE users SET is_locked_out = true WHERE username = $1', [USER]);
    expect((await login(USER, 'correct horse')).ok).toBe(false);
    await pool.query('UPDATE users SET is_locked_out = false WHERE username = $1', [USER]);
  });

  it('rejects a second user with the same email', async () => {
    await expect(
      pool.query('INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3)', [
        `__test_dup_${run}`,
        LEGACY_HASH,
        EMAIL.toUpperCase(),
      ]),
    ).rejects.toThrow(/unique/i);
  });

  it('works through the HTML form too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: `username=${USER}&password=correct%20horse&returnUrl=%2Faccount`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/account');
    const bad = await app.inject({
      method: 'POST',
      url: '/login',
      payload: `username=${USER}&password=nope&returnUrl=https%3A%2F%2Fevil.example`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(bad.headers.location).toBe('/login?error=1&returnUrl=%2F'); // open redirect blocked
  });
});

describe('authorisation', () => {
  it('plain user: own groups yes, admin no', async () => {
    const { cookies } = await login(USER, 'correct horse');
    expect(await whoami(cookies)).toBe(USER);

    const home = await app.inject({ url: '/', cookies });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('My pilot groups');
    expect(home.body).toContain(`Test group ${run}`);

    const admin = await app.inject({ url: '/admin', cookies });
    expect(admin.statusCode).toBe(302);
    expect(admin.headers.location).toBe('/403');
    expect((await app.inject({ url: '/403', cookies })).statusCode).toBe(403);
  });

  it('admin: can open /admin', async () => {
    const { cookies } = await login(ADMIN, 'correct horse');
    const admin = await app.inject({ url: '/admin', cookies });
    expect(admin.statusCode).toBe(200);
    expect(admin.body).toContain(ADMIN);
  });

  it('logout invalidates the session', async () => {
    const { cookies } = await login(USER, 'correct horse');
    expect(await whoami(cookies)).toBe(USER);
    expect((await app.inject({ method: 'POST', url: '/logout', cookies })).statusCode).toBe(302);
    expect(await whoami(cookies)).toBeNull();
  });
});
