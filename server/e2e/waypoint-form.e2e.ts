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

// Browser test of the checks the add form makes in the page itself, before anything is sent: the
// button waits until the required fields are filled in, the length limits hold, and the page does
// not judge the figures (the ranges are the server's rule, tested in waypoint-input.test.ts): an
// out-of-range latitude is sent, and only the latitude comes back flagged. Run with
// `npm run test:e2e`.
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_e2ewf_${run}`;
const PASSWORD = 'correct horse';

let app: FastifyInstance;
let pool: Pool;
let browser: Browser;
let base: string;
let eventId: number;
let userId: string;

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  const {
    rows: [u],
  } = await pool.query<{ id: string }>(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [USER, await hashPassword(PASSWORD)],
  );
  userId = u!.id;
  await pool.query(
    'INSERT INTO user_profiles (user_id, is_simple_events_model) VALUES ($1, false)',
    [userId],
  );
  const {
    rows: [e],
  } = await pool.query<{ id: number }>(
    'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
    [userId, `E2E form ${run}`],
  );
  eventId = e!.id;
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

const useFormat = (format: string) =>
  pool.query('UPDATE user_profiles SET coord_format = $2 WHERE user_id = $1', [userId, format]);
const count = async () =>
  (
    await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM waypoints WHERE event_id = $1',
      [eventId],
    )
  ).rows[0]!.n;

async function open(format: string): Promise<Page> {
  await useFormat(format);
  const page = await browser.newPage();
  await page.goto(`${base}/login`);
  await page.fill('main input[name="username"]', USER);
  await page.fill('main input[name="password"]', PASSWORD);
  await page.click('main button[type="submit"]');
  await page.waitForURL(`${base}/`);
  await page.goto(`${base}/events/${eventId}/waypoints`);
  return page;
}

const addButton = (page: Page) => page.locator('#add-waypoint button[type="submit"]');
const invalid = (page: Page) => page.locator('#add-waypoint .is-invalid');

describe('the add form, in the page', () => {
  it('waits for every required field (decimal degrees)', async () => {
    const page = await open('Deg');
    try {
      // the altitude starts at 0, the rest is empty
      expect(await addButton(page).isDisabled()).toBe(true);
      await page.fill('#add-name', 'ONE');
      expect(await addButton(page).isDisabled()).toBe(true);
      await page.fill('#add-lat', '-26.06966');
      expect(await addButton(page).isDisabled()).toBe(true);
      await page.fill('#add-lon', '151.5');
      expect(await addButton(page).isDisabled()).toBe(false);
      // clearing the altitude, or the name, takes it away again
      await page.fill('#add-alt', '');
      expect(await addButton(page).isDisabled()).toBe(true);
      await page.fill('#add-alt', '0');
      expect(await addButton(page).isDisabled()).toBe(false);
      await page.fill('#add-name', '');
      expect(await addButton(page).isDisabled()).toBe(true);
      // the description is optional
      await page.fill('#add-name', 'ONE');
      expect(await addButton(page).isDisabled()).toBe(false);
      expect(await page.locator('#add-description').getAttribute('required')).toBeNull();
    } finally {
      await page.close();
    }
  });

  it('waits for every required field (degrees minutes seconds)', async () => {
    const page = await open('DegMinSec');
    try {
      await page.fill('#add-name', 'TWO');
      for (const id of ['latD', 'latM', 'latS', 'lonD', 'lonM']) {
        await page.fill(`#add-${id}`, '1');
        expect(await addButton(page).isDisabled(), `before ${id} of the last`).toBe(true);
      }
      await page.fill('#add-lonS', '1');
      expect(await addButton(page).isDisabled()).toBe(false);
      await page.fill('#add-latM', '');
      expect(await addButton(page).isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('limits the length of the name (50), the description (500) and the altitude (10)', async () => {
    const page = await open('Deg');
    try {
      await page.fill('#add-name', 'N'.repeat(60));
      await page.fill('#add-description', 'D'.repeat(600));
      await page.fill('#add-alt', '1'.repeat(20));
      expect((await page.inputValue('#add-name')).length).toBe(50);
      expect((await page.inputValue('#add-description')).length).toBe(500);
      expect((await page.inputValue('#add-alt')).length).toBe(10);
    } finally {
      await page.close();
    }
  });

  it('does not judge the figures: the server flags only what is wrong, and a good form is not flagged', async () => {
    const page = await open('Deg');
    try {
      const before = await count();
      await page.fill('#add-name', 'GOOD');
      await page.fill('#add-lat', '95'); // out of range: the page lets it through
      await page.fill('#add-lon', '10');
      expect(await addButton(page).isDisabled()).toBe(false);
      await addButton(page).click();
      await page.waitForSelector('#add-waypoint .is-invalid');
      expect(await invalid(page).count()).toBe(1);
      expect(await page.locator('#add-waypoint .invalid-feedback').innerText()).toContain(
        'Latitude should be from -90 to 90 degrees',
      );
      expect(await page.inputValue('#add-name')).toBe('GOOD'); // what was typed is kept
      expect(await count()).toBe(before);

      // the same form, corrected
      await page.fill('#add-lat', '-26.06966');
      await addButton(page).click();
      await page.waitForSelector('#waypoints tr:has-text("GOOD")');
      expect(await invalid(page).count()).toBe(0);
      expect(await count()).toBe(before + 1);
    } finally {
      await page.close();
    }
  });
});
