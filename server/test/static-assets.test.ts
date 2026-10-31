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

// The home page links to vendor CSS/JS/fonts and our own assets; make sure every one of them is
// actually served. No database access: static files are registered before the session hook.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db.ts';

let app: FastifyInstance;

beforeAll(async () => {
  const config = loadConfig();
  app = await buildApp(config, createPool(config.DATABASE_URL));
});

afterAll(async () => {
  await app.close();
});

describe('static assets', () => {
  it.each([
    ['/vendor/bootstrap/css/bootstrap.min.css', 'text/css'],
    ['/vendor/bootstrap/js/bootstrap.bundle.min.js', 'javascript'],
    ['/vendor/fontawesome/css/all.min.css', 'text/css'],
    ['/vendor/fontawesome/webfonts/fa-solid-900.woff2', 'font/woff2'],
    ['/vendor/fontawesome/webfonts/fa-regular-400.woff2', 'font/woff2'],
    ['/assets/css/flytrace.css', 'text/css'],
    ['/assets/js/app.js', 'javascript'],
    ['/assets/img/background.jpg', 'image/jpeg'],
    ['/assets/img/screenshots/01-sizeA.jpg', 'image/jpeg'],
    ['/assets/img/screenshots/03-sizeC.jpg', 'image/jpeg'],
  ])('serves %s', async (url, type) => {
    const res = await app.inject({ url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(type);
  });

  it('does not serve files outside the asset folders', async () => {
    expect(
      (await app.inject({ url: '/assets/../package.json' })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await app.inject({ url: '/assets/%2e%2e/package.json' })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ url: '/assets/css/missing.css' })).statusCode).toBe(404);
  });
});
