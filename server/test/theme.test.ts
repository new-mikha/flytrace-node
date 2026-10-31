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

// Day / night theme: day by default whatever the browser prefers, kept in a cookie, switchable from
// the menu.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';

let app: FastifyInstance;
let ip = 0;
const get = (
  url: string,
  extra: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
) => app.inject({ url, remoteAddress: `10.4.0.${++ip}`, ...extra });

beforeAll(async () => {
  const config = loadConfig();
  app = await buildApp({ ...config, SMTP_HOST: undefined }, createPool(config.DATABASE_URL));
});
afterAll(async () => {
  await app.close();
});

describe('theme', () => {
  it('is the day theme by default, even when the browser asks for dark', async () => {
    const plain = await get('/login');
    expect(plain.body).toContain('<html lang="en" data-bs-theme="light">');
    const dark = await get('/login', { headers: { 'sec-ch-prefers-color-scheme': 'dark' } });
    expect(dark.body).toContain('data-bs-theme="light"');
  });

  it('follows the cookie, and treats anything but "dark" as day', async () => {
    expect((await get('/login', { cookies: { 'ft-theme': 'dark' } })).body).toContain(
      'data-bs-theme="dark"',
    );
    expect((await get('/login', { cookies: { 'ft-theme': 'nonsense' } })).body).toContain(
      'data-bs-theme="light"',
    );
  });

  it('leaves page fragments alone', async () => {
    const fragment = await get('/?fragment=1', { cookies: { 'ft-theme': 'dark' } });
    expect(fragment.body).not.toContain('data-bs-theme');
  });

  it('switches with /theme (for browsers without JavaScript) and returns to the page', async () => {
    const toDark = await get('/theme?returnUrl=%2Fregister');
    expect(toDark.statusCode).toBe(302);
    expect(toDark.headers.location).toBe('/register');
    const cookie = toDark.cookies.find((c) => c.name === 'ft-theme');
    expect(cookie?.value).toBe('dark');
    expect(cookie?.maxAge).toBeGreaterThan(300 * 24 * 3600); // kept for about a year

    const back = await get('/theme', { cookies: { 'ft-theme': 'dark' } });
    expect(back.cookies.find((c) => c.name === 'ft-theme')?.value).toBe('light');
    expect(
      (await get('/theme?set=dark', { cookies: { 'ft-theme': 'dark' } })).cookies[0]?.value,
    ).toBe('dark');
  });

  it('does not redirect anywhere but this site', async () => {
    expect((await get('/theme?returnUrl=https%3A%2F%2Fevil.example')).headers.location).toBe('/');
    expect((await get('/theme?returnUrl=%2F%2Fevil.example')).headers.location).toBe('/');
  });

  it('has the switch in the menu: moon, track with knob, sun, no words, and a link that returns to the page', async () => {
    const page = await get('/register');
    expect(page.body).toContain('ft-switch-knob');
    expect(page.body).toContain('data-theme-toggle');
    expect(page.body).toContain('href="/theme?returnUrl=%2Fregister"');
    expect(page.body).not.toContain('Night mode</span>');
    expect(page.body).not.toContain('Day mode');
  });
});
