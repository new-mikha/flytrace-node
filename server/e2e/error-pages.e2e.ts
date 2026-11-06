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

// Browser test of a crash while a form is sent in place: the person stays on the page, is told so,
// and can try again. See bulk-buttons.e2e.ts for how these run.
import type { FastifyInstance } from 'fastify';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_e2e_${run}`;
const PASSWORD = 'correct horse';

let app: FastifyInstance;
let pool: Pool;
let browser: Browser;
let base: string;
let eventId: number;
let crashing = false;

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  const {
    rows: [u],
  } = await pool.query<{ id: number }>(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [USER, await hashPassword(PASSWORD)],
  );
  await pool.query(
    'INSERT INTO user_profiles (user_id, is_simple_events_model) VALUES ($1, false)',
    [u!.id],
  ); // multiple-events mode: the event has a name to change
  const {
    rows: [e],
  } = await pool.query<{ id: number }>(
    'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
    [u!.id, `E2E ${run}`],
  );
  eventId = e!.id;

  app = await buildApp(config, pool);
  app.addHook('preHandler', async (request) => {
    if (crashing && request.method === 'POST') throw new Error('A crash for the test');
  });
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
});

afterAll(async () => {
  await browser?.close();
  // events cascade:
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await app?.close();
});

describe('a crash while a form is sent in place', () => {
  it('leaves the person on the page, told so, and a second try works', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/login`);
      await page.fill('main input[name="username"]', USER);
      await page.fill('main input[name="password"]', PASSWORD);
      await page.click('main button[type="submit"]');
      await page.waitForURL(`${base}/`);

      await page.goto(`${base}/events/${eventId}`);
      await page.fill('#details input[name="name"]', `Renamed ${run}`);

      crashing = true;
      await page.click('#details button[type="submit"]');
      await page.waitForSelector('#ft-flash .alert-danger');
      expect(await page.textContent('#ft-flash .alert-danger')).toContain('Something went wrong');
      expect(page.url()).toBe(`${base}/events/${eventId}`);
      expect(await page.locator('#details.ft-pending').count()).toBe(0);
      expect(await page.inputValue('#details input[name="name"]')).toBe(`Renamed ${run}`);

      crashing = false;
      await page.click('#details button[type="submit"]');
      await page.waitForSelector('#ft-flash .alert-success');
      const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [eventId]);
      expect(rows[0].name).toBe(`Renamed ${run}`);
    } finally {
      await page.close();
    }
  });
});
