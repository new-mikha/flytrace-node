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

// Browser test of the two bulk buttons on the event page ("Use all waypoints, sorted by name" / "in the order added"):
// a real server on a free port, the dev database, and Chrome (Playwright). Run with `npm run test:e2e`.
// Chrome: the installed Google Chrome by default; PLAYWRIGHT_CHROMIUM_PATH points at another browser binary (e.g. on a build server).
import type { FastifyInstance } from 'fastify';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_e2e_${run}`;
const PASSWORD = 'correct horse';
// Added in this order (so with these ids), which is neither the alphabetical order nor the reverse of it.
const ADDED = ['C2', 'A10', 'A2', 'B1'];

let app: FastifyInstance;
let pool: Pool;
let browser: Browser;
let base: string;
let eventId: number;

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  const { rows: [u] } = await pool.query<{ id: number; }>(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [USER, await hashPassword(PASSWORD)],
  );
  await pool.query(
    'INSERT INTO user_profiles (user_id, is_simple_events_model) VALUES ($1, false)',
    [u!.id],
  ); // multiple-events mode: /events/:id
  const { rows: [e] } = await pool.query<{ id: number; }>(
    'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
    [u!.id, `E2E ${run}`],
  );
  eventId = e!.id;
  for (const name of ADDED)
    await pool.query(
      'INSERT INTO waypoints (event_id, name, lat, lon, alt) VALUES ($1, $2, -30, 150, 100)',
      [eventId, name],
    );

  app = await buildApp(config, pool);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
});

afterAll(async () => {
  await browser?.close();
  await pool.query('DELETE FROM users WHERE username = $1', [USER]); // events, waypoints and tasks cascade
  await app?.close();
});

/** The selected waypoint and the radius of every filled line of the task table. */
const rows = (page: Page) =>
  page.$$eval('#ft-task-form tr.ft-task-row', (trs) =>
    trs
      .map((tr) => ({
        wpt: (tr.querySelector('select[name="wpt"]') as HTMLSelectElement).selectedOptions[0]
          ?.textContent ?? '',
        radius: (tr.querySelector('input[name="radius"]') as HTMLInputElement).value,
      }))
      .filter((r) => r.wpt !== ''));

describe('bulk buttons on the event page', () => {
  it('fill the task in the order added or by name, with the typed radius, and make the task savable', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/login`);
      await page.fill('main input[name="username"]', USER);
      await page.fill('main input[name="password"]', PASSWORD);
      await page.click('main button[type="submit"]');
      await page.waitForURL(`${base}/`);

      await page.goto(`${base}/events/${eventId}`);
      expect(await rows(page)).toEqual([]);
      const save = page.locator('#ft-task-form button[type="submit"]');
      expect(await save.isDisabled()).toBe(true); // nothing to save yet

      await page.click('.ft-bulk-toggle');
      await page.fill('#ft-bulk-radius', '750');

      await page.click('[data-task-bulk="order"]');
      expect(await rows(page)).toEqual(ADDED.map((wpt) => ({ wpt, radius: '750' })));
      expect(await save.isEnabled()).toBe(true);

      await page.click('[data-task-bulk="name"]');
      expect(await rows(page)).toEqual(
        ['A2', 'A10', 'B1', 'C2'].map((wpt) => ({ wpt, radius: '750' })),
      ); // numbers by value: A2 before A10

      await page.click('[data-task-bulk="order"]'); // again: it replaces the lines, it does not add to them
      expect(await rows(page)).toEqual(ADDED.map((wpt) => ({ wpt, radius: '750' })));

      await save.click();
      await page.waitForSelector('#ft-flash .alert-success');
      const saved = await pool.query<{ name: string; radius: number; }>(
        `SELECT w.name, t.radius FROM tasks t JOIN waypoints w ON w.id = t.waypoint_id WHERE w.event_id = $1 ORDER BY t.wpt_order`,
        [eventId],
      );
      expect(saved.rows).toEqual(ADDED.map((name) => ({ name, radius: 750 })));
    } finally {
      await page.close();
    }
  });
});
