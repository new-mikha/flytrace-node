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

// The session cookie is Secure by default in production; COOKIE_SECURE=false allows logging in over plain HTTP.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const LEGACY_HASH = 'flytrace1|sk6CmI9IAI5kYPkGhFQKHTBHBqQ=|1|LwKBbxGOnPud0PqiheeXkA=='; // password: "correct horse"
const USER = `__test_cookie_${Math.random().toString(36).slice(2, 8)}`;

let pool: Pool;
let ip = 0;
const apps: FastifyInstance[] = [];

const loginCookie = async (app: FastifyInstance) => {
  const res = await app.inject({ method: 'POST', url: '/login', remoteAddress: `10.6.0.${++ip}`,
    payload: new URLSearchParams({ username: USER, password: 'correct horse' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return res.cookies.find((c) => c.name === 'flytrace.sid');
};

beforeAll(async () => {
  const config = loadConfig({ ...process.env, SMTP_HOST: '' });
  pool = createPool(config.DATABASE_URL);
  await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [USER, LEGACY_HASH]);
  for (const env of [{ COOKIE_SECURE: '' }, { COOKIE_SECURE: 'false' }]) {
    // REQUIRE_CONFIRMED_EMAIL is off here: production with it on would ask for SMTP, which this test does not need
    const appConfig = loadConfig({ ...process.env, SMTP_HOST: '', REQUIRE_CONFIRMED_EMAIL: 'false', NODE_ENV: 'production', ...env });
    apps.push(await buildApp(appConfig, createPool(appConfig.DATABASE_URL))); // closing an app also ends its pool, so each has its own
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await pool.end();
  for (const app of apps) await app.close();
});

describe('session cookie in production', () => {
  it('is not sent over plain HTTP by default (it would be Secure, and the session library then sends nothing)', async () => {
    expect(await loginCookie(apps[0]!)).toBeUndefined();
  });

  it('is sent over plain HTTP, and not marked Secure, with COOKIE_SECURE=false', async () => {
    const cookie = await loginCookie(apps[1]!);
    expect(cookie).toBeDefined();
    expect(cookie?.secure).toBeFalsy();
  });
});
