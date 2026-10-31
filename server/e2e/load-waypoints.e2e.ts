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

// Browser test of "Load waypoints first": choosing a file sends it at once (no button click), and the
// page then shows the task editor with the waypoints. Run with `npm run test:e2e`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import { parseWaypointFile } from '../src/repo/waypointFiles.ts';

const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_e2eup_${run}`;
const PASSWORD = 'correct horse';
const CUP = [
  'name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc',
  '"Jonny field",JONNY,,3318.830S,14750.088E,227.0m,1,,,,"next to the road"',
  '"Ashley",ASHLEG,,2919.000S,15057.000E,500f,1,,,,',
].join('\n');

let app: FastifyInstance;
let pool: Pool;
let browser: Browser;
let base: string;
let eventId: number;

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
  );
  const {
    rows: [e],
  } = await pool.query<{ id: number }>(
    'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
    [u!.id, `E2E upload ${run}`],
  );
  eventId = e!.id;
  app = await buildApp(config, pool);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
});

afterAll(async () => {
  await browser?.close();
  await pool.query('DELETE FROM users WHERE username = $1', [USER]); // events and waypoints cascade
  await app?.close();
});

describe('load waypoints first', () => {
  it('sends the chosen file at once; a bad file shows the reason, a good one the task editor', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/login`);
      await page.fill('main input[name="username"]', USER);
      await page.fill('main input[name="password"]', PASSWORD);
      await page.click('main button[type="submit"]');
      await page.waitForURL(`${base}/`);

      await page.goto(`${base}/events/${eventId}`);
      expect(await page.locator('#ft-task-form').count()).toBe(0);
      expect(await page.locator('#load-waypoints').isVisible()).toBe(true);

      // no button click: choosing the file is enough
      await page.setInputFiles('#ft-wpt-file', {
        name: 'broken.cup',
        mimeType: 'text/plain',
        buffer: Buffer.from(`${CUP.split('\n')[0]}\n"A",A,,3318.830X,14750.088E,227.0m,1,,,,\n`),
      });
      await page.waitForSelector('#load-waypoints .alert-danger');
      expect(await page.locator('#load-waypoints .alert-danger').innerText()).toContain(
        'hemisphere symbol',
      );

      await page.setInputFiles('#ft-wpt-file', {
        name: 'comp.cup',
        mimeType: 'text/plain',
        buffer: Buffer.from(CUP),
      });
      await page.waitForSelector('#ft-task-form');
      expect(await page.locator('#ft-flash').innerText()).toContain('Waypoints loaded: 2 added.');
      const options = await page
        .locator('#ft-task-form select[name="wpt"]')
        .last()
        .locator('option')
        .allInnerTexts();
      expect(options.filter(Boolean)).toEqual(['ASHLEG', 'JONNY']);
    } finally {
      await page.close();
    }
  });
});

describe('real files', () => {
  // The Dalby 2024 waypoints as SeeYou and as GpsDump wrote them, and the Forbes 2024 ones.
  it.each([
    ['Dalby2024.cup', 173],
    ['Dalby2024.gpx', 173],
    ['Forbes24.gpx', 164],
    ['dalby2016.kml', 174],
  ])('%s loads with all its waypoints', async (file, count) => {
    const {
      rows: [u],
    } = await pool.query<{ id: number }>('SELECT id FROM users WHERE username = $1', [USER]);
    const {
      rows: [e],
    } = await pool.query<{ id: number }>(
      'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
      [u!.id, `E2E ${file} ${run}`],
    );
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/login`);
      await page.fill('main input[name="username"]', USER);
      await page.fill('main input[name="password"]', PASSWORD);
      await page.click('main button[type="submit"]');
      await page.waitForURL(`${base}/`);
      await page.goto(`${base}/events/${e!.id}`);
      await page.setInputFiles(
        '#ft-wpt-file',
        fileURLToPath(new URL(`../test/fixtures/waypoints/${file}`, import.meta.url)),
      );
      await page.waitForSelector('#ft-task-form');
      expect(await page.locator('#ft-flash').innerText()).toContain(
        `Waypoints loaded: ${count} added.`,
      );
      expect(
        await page.locator('#ft-task-form select[name="wpt"]').last().locator('option').count(),
      ).toBe(
        count + 1, // and the empty entry
      );
      // and the database holds exactly what the parser reads from the file, in file order
      const path = fileURLToPath(new URL(`../test/fixtures/waypoints/${file}`, import.meta.url));
      const expected = parseWaypointFile(file, readFileSync(path, 'utf8'));
      const { rows } = await pool.query<{
        name: string;
        description: string | null;
        lat: number;
        lon: number;
        alt: number;
      }>('SELECT name, description, lat, lon, alt FROM waypoints WHERE event_id = $1 ORDER BY id', [
        e!.id,
      ]);
      expect(rows).toHaveLength(count);
      expect(rows).toEqual(expected);
      const tasks = await pool.query(
        'SELECT 1 FROM tasks t JOIN waypoints w ON w.id = t.waypoint_id WHERE w.event_id = $1',
        [e!.id],
      );
      expect(tasks.rowCount).toBe(0); // loading waypoints does not make a task
    } finally {
      await page.close();
    }
  });
});
