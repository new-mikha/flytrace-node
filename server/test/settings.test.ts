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

// The settings page against the dev database (needs `npm run db:migrate`).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
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
  const { rows } = await pool.query<{ id: string; }>(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [USER, await hashPassword('correct horse')],
  );
  userId = rows[0]!.id;
  app = await buildApp(config, pool);
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    remoteAddress: ip,
    headers: FORM,
    payload: new URLSearchParams({
      username: USER,
      password: 'correct horse',
      returnUrl: '/settings',
    }).toString(),
  });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid');
  cookies = cookie ? { [cookie.name]: cookie.value } : {};
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await app.close(); // also ends the pool
});

const post = (url: string, payload: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url,
    remoteAddress: ip,
    cookies,
    headers: FORM,
    payload: new URLSearchParams(payload).toString(),
  });

describe('settings', () => {
  it('need a login', async () => {
    for (
      const url of [
        '/settings',
        '/settings/events-mode',
        '/settings/altitude',
        '/settings/messages',
      ]
    ) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`/login?returnUrl=${encodeURIComponent(url)}`);
    }
    expect(
      (await app.inject({
        method: 'POST',
        url: '/settings/altitude',
        payload: 'altitude=m',
        headers: FORM,
      })).statusCode,
    ).toBe(302);
  });

  it('list every page in two groups, with the current values for phones', async () => {
    const res = await app.inject({ url: '/settings', cookies });
    expect(res.statusCode).toBe(200);
    for (
      const href of [
        '/account',
        '/account/email',
        '/account/password',
        '/account/2fa',
        '/account/personal-data',
        '/settings/events-mode',
        '/settings/altitude',
        '/settings/messages',
      ]
    )
      expect(res.body).toContain(`href="${href}"`);

    expect(res.body).toContain('>Account</h2>');
    expect(res.body).toContain('>Website</h2>');
    expect(res.body).toContain('>Single</span>');
    expect(res.body).toContain('>Off</span>');
    expect(res.body).toContain('>Show</span>');
  });

  it('are linked from the bar as plain user name, Settings and Log out (no drop-down)', async () => {
    const res = await app.inject({ url: '/settings', cookies });
    expect(res.body).toMatch(/class="nav-link active" href="\/settings"/);
    expect(res.body).toContain('Log out');
    expect(res.body).toContain(USER);
    expect(res.body).not.toContain('dropdown-menu');
  });

  it('show the same list at the left of the account pages', async () => {
    const res = await app.inject({ url: '/account/password', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('href="/settings/altitude"');
    expect(res.body).toMatch(
      /list-group-item list-group-item-action active" href="\/account\/password"/,
    );
    expect(res.body).toContain('href="/settings"'); // the way back on phones
  });

  it("show the defaults on a new user's preference pages", async () => {
    expect((await app.inject({ url: '/settings/events-mode', cookies })).body).toMatch(
      /value="single"[^>]*checked/,
    );
    const altitude = await app.inject({ url: '/settings/altitude', cookies });
    expect(altitude.body).toMatch(/value="none"[^>]*checked/);
    expect(altitude.body).toContain('Show altitude in kilometers');
    expect((await app.inject({ url: '/settings/messages', cookies })).body).toMatch(
      /value="show"[^>]*checked/,
    );
  });

  it('save one preference at a time and leave the others alone', async () => {
    let res = await post('/settings/events-mode', { eventsMode: 'multiple' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings/events-mode');
    expect((await app.inject({ url: '/settings/events-mode', cookies })).body).toContain('Saved.');
    res = await post('/settings/altitude', { altitude: 'm' });
    expect(res.headers.location).toBe('/settings/altitude');
    res = await post('/settings/messages', { messagesByDefault: 'hide' });
    expect(res.headers.location).toBe('/settings/messages');
    expect(await getSettings(pool, userId)).toEqual({
      eventsMode: 'multiple',
      altitude: 'm',
      messagesByDefault: 'hide',
    });
    expect((await post('/settings/altitude', { altitude: 'none' })).statusCode).toBe(302);
    expect(await getSettings(pool, userId)).toEqual({
      eventsMode: 'multiple',
      altitude: 'none',
      messagesByDefault: 'hide',
    });
    const index = await app.inject({ url: '/settings', cookies });
    expect(index.body).toContain('>Multiple</span>');
    expect(index.body).toContain('>Hide</span>');
  });

  it('reject a value that is not one of the choices and keep the saved settings', async () => {
    await post('/settings/altitude', { altitude: 'ft' });
    for (
      const [url, fields] of [['/settings/altitude', { altitude: 'km' }], [
        '/settings/events-mode',
        { eventsMode: 'many' },
      ], ['/settings/messages', {}]] as const
    ) {
      const res = await post(url, fields);
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain('Please choose one of the options.');
    }
    expect((await getSettings(pool, userId)).altitude).toBe('ft');
  });

  it('make the events table appear on the home page in the multiple-events mode', async () => {
    await post('/settings/events-mode', { eventsMode: 'multiple' });
    expect((await app.inject({ url: '/', cookies })).body).toContain('My events');
    await post('/settings/events-mode', { eventsMode: 'single' });
    const home = await app.inject({ url: '/', cookies });
    expect(home.body).not.toContain('My events');
    expect(home.body).toContain('Today Task'); // the single-event mode's panel, with the switch to the other mode
    expect(home.body).toContain('name="to" value="multiple"');
  });
});
