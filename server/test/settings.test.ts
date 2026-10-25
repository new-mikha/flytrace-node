// The settings page against the dev database (needs `npm run db:migrate`).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { hashPassword } from '../src/auth/password.ts';
import { createPool, type Pool } from '../src/db.ts';
import { getSettings } from '../src/repo/settings.ts';

const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_settings_${run}`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

let app: FastifyInstance;
let pool: Pool;
let userId: string;
let cookies: Record<string, string>;
const ip = '10.5.0.1';

beforeAll(async () => {
  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);
  const { rows } = await pool.query<{ id: string }>('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [USER, await hashPassword('correct horse')]);
  userId = rows[0]!.id;
  app = await buildApp(config, pool);
  const res = await app.inject({ method: 'POST', url: '/login', remoteAddress: ip, headers: FORM,
    payload: new URLSearchParams({ username: USER, password: 'correct horse', returnUrl: '/settings' }).toString() });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid');
  cookies = cookie ? { [cookie.name]: cookie.value } : {};
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await app.close(); // also ends the pool
});

const post = (payload: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/settings', remoteAddress: ip, cookies, headers: FORM, payload: new URLSearchParams(payload).toString() });

describe('settings page', () => {
  it('needs a login', async () => {
    const res = await app.inject({ url: '/settings' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?returnUrl=%2Fsettings');
    expect((await app.inject({ method: 'POST', url: '/settings', payload: 'eventsMode=multiple' , headers: FORM })).statusCode).toBe(302);
  });

  it('shows the defaults for a new user, and a Settings link in the menu', async () => {
    const res = await app.inject({ url: '/settings', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Save settings');
    expect(res.body).toMatch(/value="single"[^>]*checked/);
    expect(res.body).toMatch(/value="none"[^>]*checked/);
    expect(res.body).toMatch(/value="show"[^>]*checked/);
    expect(res.body).toContain('href="/settings"');
  });

  it('saves all three settings, shows them again', async () => {
    const res = await post({ eventsMode: 'multiple', altitude: 'm', messagesByDefault: 'hide' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings');
    expect(await getSettings(pool, userId)).toEqual({ eventsMode: 'multiple', altitude: 'm', messagesByDefault: 'hide' });
    const page = await app.inject({ url: '/settings', cookies });
    expect(page.body).toContain('Settings saved.');
    expect(page.body).toMatch(/value="multiple"[^>]*checked/);
    expect(page.body).toMatch(/value="m"[^>]*checked/);
    expect(page.body).toMatch(/value="hide"[^>]*checked/);
  });

  it('changes an existing profile and can switch altitude off again', async () => {
    expect((await post({ eventsMode: 'single', altitude: 'none', messagesByDefault: 'show' })).statusCode).toBe(302);
    expect(await getSettings(pool, userId)).toEqual({ eventsMode: 'single', altitude: 'none', messagesByDefault: 'show' });
    expect((await post({ eventsMode: 'single', altitude: 'ft', messagesByDefault: 'show' })).statusCode).toBe(302);
    expect((await getSettings(pool, userId)).altitude).toBe('ft');
  });

  it('rejects a value that is not one of the choices and keeps the saved settings', async () => {
    const res = await post({ eventsMode: 'many', altitude: 'km', messagesByDefault: 'show' });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('Please choose one option in each section.');
    expect((await getSettings(pool, userId)).altitude).toBe('ft');
    expect((await post({ eventsMode: 'single' })).statusCode).toBe(422); // missing fields
  });

  it('makes the events table appear on the home page in the multiple-events mode', async () => {
    await post({ eventsMode: 'multiple', altitude: 'none', messagesByDefault: 'show' });
    expect((await app.inject({ url: '/', cookies })).body).toContain('My events');
    await post({ eventsMode: 'single', altitude: 'none', messagesByDefault: 'show' });
    const home = await app.inject({ url: '/', cookies });
    expect(home.body).not.toContain('My events');
    expect(home.body).toContain('href="/settings">Settings</a> to manage several events');
  });
});
