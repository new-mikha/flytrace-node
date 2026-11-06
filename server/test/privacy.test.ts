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

// The privacy policy and the footer that leads to it.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

let app: FastifyInstance;
let pool: Pool;

beforeAll(async () => {
  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);
  app = await buildApp({ ...config, MAIL_CONTACT_ADDRESS: 'someone@example.com' }, pool);
});

afterAll(async () => {
  await app.close();
});

describe('the privacy policy', () => {
  it('is there for anybody, with no login', async () => {
    const res = await app.inject({ url: '/privacy' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Privacy policy - Flytrace</title>');
    expect(res.body).toContain('mailto:someone@example.com');
  });

  it('names every cookie the site sets', async () => {
    const { body } = await app.inject({ url: '/privacy' });
    for (const cookie of ['flytrace.sid', 'ft-theme', 'flytrace_coord_format'])
      expect(body).toContain(cookie);
    expect(body).toContain('numAllTracksAlertShown');
  });
});

describe('the policy and the captcha', () => {
  it('says nothing of reCAPTCHA while it is off', async () => {
    const { body } = await app.inject({ url: '/privacy' });
    expect(body).not.toContain('reCAPTCHA');
    expect(body).toContain('All the cookies');
  });

  it('tells of it, and of its cookie, when it is on', async () => {
    const config = {
      ...loadConfig(),
      RECAPTCHA_ENABLED: true,
      RECAPTCHA_SITE_KEY: 'site',
      RECAPTCHA_SECRET_KEY: 'private-key',
    };
    const own = createPool(config.DATABASE_URL);
    const on = await buildApp(config, own);
    try {
      const { body } = await on.inject({ url: '/privacy' });
      expect(body).toContain('Google reCAPTCHA');
      expect(body).toContain('_GRECAPTCHA');
      expect(body).toContain('Apart from reCAPTCHA, all the cookies');
      expect(body).not.toContain('private-key');
    } finally {
      await on.close();
    }
  });
});

describe('the footer', () => {
  it.each(['/', '/login', '/privacy', '/no-such-page'])('is on %s', async (url) => {
    const res = await app.inject({ url, headers: { accept: 'text/html' } });

    expect(res.body).toContain('<footer class="ft-footer">');
    expect(res.body).toContain('href="/privacy"');
    expect(res.body).toContain('href="mailto:someone@example.com">Email us');
    expect(res.body).not.toContain('ft-contact');
    expect(res.body).toContain('href="https://github.com/new-mikha/flytrace-node"');
  });
});
