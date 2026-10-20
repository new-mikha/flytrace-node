// End-to-end auth and authorisation flow against the dev database (needs `npm run db:migrate`).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { authenticate } from '../src/auth/service.ts';
import { hashPassword } from '../src/auth/password.ts';
import { createPool, type Pool } from '../src/db.ts';

const SALT = 'LwKBbxGOnPud0PqiheeXkA==';
const LEGACY_HASH = `flytrace1|sk6CmI9IAI5kYPkGhFQKHTBHBqQ=|1|${SALT}`; // password: "correct horse"
const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_user_${run}`;
const ADMIN = `__test_admin_${run}`;
const EMAIL = `__test_${run}@example.test`;

let app: FastifyInstance;
let pool: Pool;

async function login(username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid');
  return { res, cookies: cookie ? { [cookie.name]: cookie.value } : {} };
}

beforeAll(async () => {
  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);
  await pool.query(`INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $4), ($3, $2, NULL)`,
    [USER, LEGACY_HASH, ADMIN, EMAIL]);
  await pool.query(`INSERT INTO user_roles (user_id, role_id)
                    SELECT u.id, r.id FROM users u, roles r WHERE u.username = $1 AND r.name = 'Admins'`, [ADMIN]);
  await pool.query(`INSERT INTO groups (name, user_id) SELECT 'Test group ' || $2, id FROM users WHERE username = $1`, [USER, run]);
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
  it('is redirected to login from protected pages and gets 401 from the API', async () => {
    const res = await app.inject({ url: '/groups' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?returnUrl=%2Fgroups');
    expect((await app.inject({ url: '/admin' })).statusCode).toBe(302);
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
  });
});

describe('login', () => {
  it('rejects a wrong password and unknown users', async () => {
    expect((await login(USER, 'wrong')).res.statusCode).toBe(401);
    expect((await login('nobody_' + run, 'x')).res.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: {} })).statusCode).toBe(400);
  });

  it('accepts a legacy password and upgrades the hash', async () => {
    const { res } = await login(USER, 'correct horse');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: USER, roles: [] });
    const { rows } = await pool.query<{ password_hash: string; last_login_at: Date | null }>(
      'SELECT password_hash, last_login_at FROM users WHERE username = $1', [USER]);
    expect(rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(rows[0]?.last_login_at).not.toBeNull();
    // still works with the upgraded hash
    expect((await login(USER, 'correct horse')).res.statusCode).toBe(200);
  });

  it('accepts the email address as the login name, case-insensitively', async () => {
    const { res } = await login(EMAIL.toUpperCase(), 'correct horse');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: USER });
    expect((await login(EMAIL, 'wrong')).res.statusCode).toBe(401);
  });

  it('spends similar time on unknown names and wrong passwords (no user enumeration by timing)', async () => {
    const name = `__test_timing_${run}`;
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [name, await hashPassword('right')]);
    const time = async (login: string) => {
      const start = performance.now();
      expect(await authenticate(pool, login, 'wrong')).toBeNull();
      return performance.now() - start;
    };
    await time(name); await time('nobody_' + run); // warm up (connection, dummy hash)
    const known = Math.min(await time(name), await time(name), await time(name));
    const unknown = Math.min(await time('nobody_' + run), await time('nobody_' + run), await time('nobody_' + run));
    expect(unknown).toBeGreaterThan(known * 0.5);
  });

  it('refuses locked-out users', async () => {
    await pool.query('UPDATE users SET is_locked_out = true WHERE username = $1', [USER]);
    expect((await login(USER, 'correct horse')).res.statusCode).toBe(401);
    await pool.query('UPDATE users SET is_locked_out = false WHERE username = $1', [USER]);
  });

  it('rejects a second user with the same email', async () => {
    await expect(pool.query('INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3)',
      [`__test_dup_${run}`, LEGACY_HASH, EMAIL.toUpperCase()])).rejects.toThrow(/unique/i);
  });

  it('works through the HTML form too', async () => {
    const res = await app.inject({ method: 'POST', url: '/login',
      payload: `username=${USER}&password=correct%20horse&returnUrl=%2Fgroups`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/groups');
    const bad = await app.inject({ method: 'POST', url: '/login',
      payload: `username=${USER}&password=nope&returnUrl=https%3A%2F%2Fevil.example`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(bad.headers.location).toBe('/login?error=1&returnUrl=%2F'); // open redirect blocked
  });
});

describe('authorisation', () => {
  it('plain user: own groups yes, admin no', async () => {
    const { cookies } = await login(USER, 'correct horse');
    const me = await app.inject({ url: '/api/me', cookies });
    expect(me.json()).toMatchObject({ username: USER });

    const groups = await app.inject({ url: '/groups', cookies });
    expect(groups.statusCode).toBe(200);
    expect(groups.body).toContain(`Test group ${run}`);

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
    expect((await app.inject({ method: 'POST', url: '/api/logout', cookies })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/me', cookies })).statusCode).toBe(401);
  });
});
