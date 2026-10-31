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

// Browser test of the waypoints manager: the format list saves at once, Edit opens the row in
// place, Update and Delete (through the dialog) are sent in place, adding by hand, and the stored
// rows are checked in the database. Run with `npm run test:e2e`.
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_e2ewm_${run}`;
const PASSWORD = 'correct horse';

let app: FastifyInstance;
let pool: Pool;
let browser: Browser;
let base: string;
let eventId: number;

// the row just changed flashes: its cells have a running animation
const flashing = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      Array.from(document.querySelectorAll('#waypoints tr.ft-wpt-new')).some(
        (tr) =>
          tr.textContent?.includes(n) &&
          Array.from(tr.children).some((td) => td.getAnimations().length > 0),
      ),
    name,
  );

const stored = async () =>
  (
    await pool.query<{ name: string; lat: number; lon: number; alt: number; description: string }>(
      'SELECT name, lat, lon, alt, description FROM waypoints WHERE event_id = $1 ORDER BY id',
      [eventId],
    )
  ).rows;

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
    [u!.id, `E2E manager ${run}`],
  );
  eventId = e!.id;
  await pool.query(
    `INSERT INTO waypoints (event_id, name, lat, lon, alt, description)
     VALUES ($1, 'ALPHA', -26.06966, 151.5, 100, 'first'), ($1, 'BRAVO', -33.313833, 150, 200, NULL)`,
    [eventId],
  );
  app = await buildApp(config, pool);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
});

afterAll(async () => {
  await browser?.close();
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await app?.close();
});

describe('waypoints manager', () => {
  it('changes the format, edits, adds and deletes in place', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/login`);
      await page.fill('main input[name="username"]', USER);
      await page.fill('main input[name="password"]', PASSWORD);
      await page.click('main button[type="submit"]');
      await page.waitForURL(`${base}/`);

      await page.goto(`${base}/events/${eventId}/waypoints`);
      await page.evaluate(() => ((window as any).marker = 'same page'));
      expect(await page.locator('#waypoints tbody tr').count()).toBe(2);

      // the format list saves at once
      await page.selectOption('#ft-coord-format', 'DegMin');
      await page.waitForSelector('#waypoints td:has-text("S 33°")');
      expect(await page.evaluate(() => (window as any).marker)).toBe('same page');

      // Edit opens in place; the stored zero after the decimal point survives a round trip
      await page.click('#waypoints tr:has-text("ALPHA") a[data-wpt-edit]');
      await page.waitForSelector('#waypoints .ft-wpt-edit');
      expect(await page.inputValue('#edit-' + (await idOf('ALPHA')) + '-latD')).toBe('26');
      await page.fill('#waypoints .ft-wpt-edit input[name="alt"]', '123.5');
      await page.click('#waypoints .ft-wpt-edit button[type="submit"]');
      await page.waitForSelector('#waypoints td[data-label="Alt"]:has-text("123.5")');
      expect(await page.evaluate(() => (window as any).marker)).toBe('same page');
      expect(await flashing(page, 'ALPHA')).toBe(true);
      const [alpha] = await stored();
      expect(alpha!.alt).toBe(123.5);
      expect(alpha!.lat).toBeCloseTo(-26.06966, 4);

      // add by hand
      await page.fill('#add-name', 'CHARLIE');
      await page.selectOption('#add-waypoint select[name="latH"]', 'N');
      await page.fill('#add-latD', '12');
      await page.fill('#add-latM', '30');
      await page.selectOption('#add-waypoint select[name="lonH"]', 'E');
      await page.fill('#add-lonD', '100');
      await page.fill('#add-lonM', '15.5');
      await page.fill('#add-alt', '5');
      await page.click('#add-waypoint button[type="submit"]');
      await page.waitForSelector('#waypoints tr:has-text("CHARLIE")');
      expect(await flashing(page, 'CHARLIE')).toBe(true);
      const charlie = (await stored()).find((w) => w.name === 'CHARLIE')!;
      expect(charlie.lat).toBeCloseTo(12.5, 9);
      expect(charlie.lon).toBeCloseTo(100 + 15.5 / 60, 9);

      // Delete asks in the dialog
      await page.click('#waypoints tr:has-text("BRAVO") a[data-confirm-action]');
      await page.waitForSelector('#ft-confirm.show');
      expect(await page.locator('#ft-confirm-text').innerText()).toContain('BRAVO');
      await page.click('#ft-confirm-button');
      await page.waitForSelector('#waypoints tr:has-text("BRAVO")', { state: 'detached' });
      expect((await stored()).map((w) => w.name)).toEqual(['ALPHA', 'CHARLIE']);
      expect(await page.evaluate(() => (window as any).marker)).toBe('same page');

      // a refused delete (the waypoint is in the task) does not scroll back to the marked row
      await pool.query(
        "INSERT INTO waypoints (event_id, name, lat, lon, alt) SELECT $1, 'Z' || n, 1, 2, 3 FROM generate_series(10, 60) n",
        [eventId],
      );
      await pool.query('INSERT INTO tasks (waypoint_id, radius, wpt_order) VALUES ($1, 400, 0)', [
        await idOf('Z60'),
      ]);
      await page.goto(`${base}/events/${eventId}/waypoints`);
      await page
        .locator('#waypoints tr:has-text("Z60") a[data-confirm-action]')
        .scrollIntoViewIfNeeded();
      await page.click('#waypoints tr:has-text("Z60") a[data-confirm-action]');
      await page.waitForSelector('#ft-confirm.show');
      const rowTop = () =>
        page.evaluate(
          () =>
            Array.from(document.querySelectorAll('#waypoints tr'))
              .find((tr) => tr.textContent?.includes('Z60'))!
              .getBoundingClientRect().top,
        );
      const before = await rowTop();
      await page.click('#ft-confirm-button');
      await page.waitForSelector('#ft-flash .alert-danger');
      await page.waitForTimeout(800);
      // (the message above may push the page down, so the row is compared on the screen)
      expect(Math.abs((await rowTop()) - before)).toBeLessThan(150);
      // still on the screen: it did not jump to the marked row
      const after = await rowTop();
      expect(after > 0 && after < 900).toBe(true);

      // the mark of the last add or edit survives the refused delete (no flash), not a reload
      expect(await page.locator('#waypoints tr.ft-wpt-keep').count()).toBe(0); // nothing was added on this page
      await page.fill('#add-name', 'ZED');
      await page.fill('#add-latD', '1');
      await page.fill('#add-latM', '0');
      await page.fill('#add-lonD', '2');
      await page.fill('#add-lonM', '0');
      await page.click('#add-waypoint button[type="submit"]');
      await page.waitForSelector('#waypoints tr.ft-wpt-new');
      await page.click('#waypoints tr:has-text("Z60") a[data-confirm-action]');
      await page.waitForSelector('#ft-confirm.show');
      await page.click('#ft-confirm-button');
      await page.waitForSelector('#ft-flash .alert-danger');
      await page.waitForSelector('#waypoints tr.ft-wpt-keep:has-text("ZED")');
      await page.reload();
      expect(
        await page.locator('#waypoints tr.ft-wpt-new, #waypoints tr.ft-wpt-keep').count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  });
});

async function idOf(name: string): Promise<number> {
  return (
    await pool.query<{ id: number }>('SELECT id FROM waypoints WHERE event_id = $1 AND name = $2', [
      eventId,
      name,
    ])
  ).rows[0]!.id;
}
