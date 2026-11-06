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

// What a person, and anything else that asks, gets for a wrong address and for a crash.
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const USER = `__test_errors_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'correct horse';
const PAGE = { accept: 'text/html,application/xhtml+xml' };
const SECRET = 'the internals of the database';

let app: FastifyInstance;
let pool: Pool;
let logged = '';

beforeAll(async () => {
  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logged += chunk.toString();
      done();
    },
  });
  app = await buildApp(config, pool, undefined, stream);
  app.get('/__test/crash', () => {
    throw new Error(SECRET);
  });
  app.get('/__test/status/:status', (request) => {
    const { status } = request.params as { status: string };
    throw Object.assign(new Error(SECRET), { statusCode: Number(status) });
  });
  await pool.query(`INSERT INTO users (username, password_hash) VALUES ($1, $2)`, [
    USER,
    await hashPassword(PASSWORD),
  ]);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await app.close();
});

describe('an address nothing answers', () => {
  it('gets a page with the way home', async () => {
    const res = await app.inject({ url: '/no-such-page', headers: PAGE });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Page not found');
    expect(res.body).toContain('Go to the home page');
    expect(res.body).toContain('data-bs-theme="light"');
  });

  it('keeps the person signed in, with their menu', async () => {
    const remoteAddress = '10.77.0.1';
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      remoteAddress,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ username: USER, password: PASSWORD }).toString(),
    });
    const cookie = login.cookies.find((c) => c.name === 'flytrace.sid')!;

    const res = await app.inject({
      url: '/no-such-page',
      remoteAddress,
      headers: PAGE,
      cookies: { [cookie.name]: cookie.value },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain(USER);
  });

  it('gets the page for a legacy address too, until nginx sends those on', async () => {
    const res = await app.inject({ url: '/default.aspx?x=1', headers: PAGE });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Page not found');
  });

  it('gets a line of JSON when no page was asked for', async () => {
    const res = await app.inject({
      url: '/assets/img/missing.png',
      headers: { accept: 'image/*' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Page not found' });
  });

  it('is treated alike with no Accept at all', async () => {
    const res = await app.inject({ url: '/no-such-page' });
    expect(res.json()).toEqual({ error: 'Page not found' });
  });
});

describe('a crash', () => {
  it('gets a page that tells nothing of what happened', async () => {
    const res = await app.inject({ url: '/__test/crash', headers: PAGE });

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('Something went wrong');
    expect(res.body).not.toContain(SECRET);
  });

  it('tells nothing in JSON either', async () => {
    const res = await app.inject({ url: '/__test/crash' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Something went wrong' });
  });

  it('is logged as an ERROR, with the details', async () => {
    logged = '';
    await app.inject({ url: '/__test/crash', headers: PAGE });

    const line = logged
      .split('\n')
      .filter(Boolean)
      .map((text) => JSON.parse(text) as { level: number; msg: string; err?: { stack: string } })
      .find((entry) => entry.level === 50);
    expect(line?.msg).toBe(SECRET);
    expect(line?.err?.stack).toContain('error-pages.test');
  });

  it('counts an error of a strange status as a crash', async () => {
    expect((await app.inject({ url: '/__test/status/200' })).statusCode).toBe(500);
    expect((await app.inject({ url: '/__test/status/503' })).statusCode).toBe(503);
  });
});

describe('a refused request', () => {
  it('keeps its status, tells nothing, and is no ERROR', async () => {
    logged = '';
    const res = await app.inject({ url: '/__test/status/400', headers: PAGE });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('That did not work');
    expect(res.body).not.toContain(SECRET);
    expect(logged).not.toContain('"level":50');
  });

  it('says to wait when there were too many', async () => {
    const res = await app.inject({ url: '/__test/status/429', headers: PAGE });

    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('Please wait a minute');
  });

  it('gives the map its status for a broken body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/map/1/tracks',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'That did not work' });
  });
});
