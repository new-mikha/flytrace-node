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

// Browser test of the captcha on a form: Google's script is loaded when the person starts, the
// token goes with the form, and a blocked script still gets an answer. Google is stubbed at both
// ends. See bulk-buttons.e2e.ts for how these run.
import type { FastifyInstance } from 'fastify';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const SCRIPT = 'https://www.google.com/recaptcha/api.js*';
const FAKE_GOOGLE = `window.grecaptcha = {
  ready: (done) => done(),
  execute: async (key, { action }) => key + ':' + action,
};`;

let app: FastifyInstance;
let pool: Pool;
let browser: Browser;
let base: string;
const tokens: string[] = [];

beforeAll(async () => {
  const config = {
    ...loadConfig(),
    SMTP_HOST: undefined,
    RECAPTCHA_ENABLED: true,
    RECAPTCHA_SITE_KEY: 'public-key',
    RECAPTCHA_SECRET_KEY: 'private-key',
  };
  pool = createPool(config.DATABASE_URL);
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    if (!String(url).includes('siteverify')) return realFetch(url, init);
    const token = (init.body as URLSearchParams).get('response')!;
    tokens.push(token);
    return Promise.resolve(
      Response.json({ success: true, score: 0.9, action: token.split(':')[1] }),
    );
  });
  app = await buildApp(config, pool);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await browser?.close();
  await app?.close();
});

async function withPage(run: (page: Page, asked: string[]) => Promise<void>, block = false) {
  const page = await browser.newPage();
  const asked: string[] = [];
  page.setDefaultTimeout(6000);
  await page.route(SCRIPT, (route) => {
    asked.push(route.request().url());
    return block
      ? route.abort()
      : route.fulfill({ contentType: 'text/javascript', body: FAKE_GOOGLE });
  });
  try {
    await run(page, asked);
  } finally {
    await page.close();
  }
}

describe('the captcha on a form', () => {
  it('loads Google only when the person starts, and sends the token', async () => {
    await withPage(async (page, asked) => {
      await page.goto(`${base}/forgot-password`);
      // The field has `autofocus`, which comes before the script: this makes it see the start.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.fill('main input[name="login"]', 'nobody_at_all');
      await page.click('main button[type="submit"]');
      await page.waitForSelector('text=Check your email');

      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('render=public-key');
      expect(tokens.at(-1)).toBe('public-key:forgot_password');
    });
  });

  it('does not load Google on a page without such a form', async () => {
    await withPage(async (page, asked) => {
      await page.goto(`${base}/login`);
      await page.fill('main input[name="username"]', 'x');
      expect(asked).toEqual([]);
    });
  });

  it('answers with a way out when the script is blocked', async () => {
    await withPage(async (page) => {
      await page.goto(`${base}/forgot-password`);
      await page.fill('main input[name="login"]', 'nobody_at_all');
      await page.click('main button[type="submit"]');
      await page.waitForSelector('text=We could not tell that you are a person');
    }, true);
  });
});
