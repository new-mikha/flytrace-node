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

// The captcha: what each answer of Google's leads to, on the forms that use it. `fetch` is stubbed.
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { type Config, loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const USER = `__test_cap_${run}`;
const form = { 'content-type': 'application/x-www-form-urlencoded' };
let client = 0;

const google = vi.fn<() => Promise<Response>>();
const verdict = (body: object) => google.mockResolvedValue(Response.json(body));
const good = { success: true, score: 0.9, action: 'forgot_password' };

let app: FastifyInstance;
let off: FastifyInstance;
let pool: Pool;
let poolOff: Pool;
let config: Config;
let logged = '';

const post = (url: string, fields: Record<string, string>, on = app) =>
  on.inject({
    method: 'POST',
    url,
    headers: form,
    // Each its own client: the forms have a rate limit per address.
    remoteAddress: `10.79.${Math.floor(++client / 200)}.${client % 200}`,
    payload: new URLSearchParams(fields).toString(),
  });
const forgot = (captcha: string) => post('/forgot-password', { login: `nobody_${run}`, captcha });

beforeAll(async () => {
  const base = loadConfig();
  config = {
    ...base,
    RECAPTCHA_ENABLED: true,
    RECAPTCHA_SITE_KEY: 'public-key',
    RECAPTCHA_SECRET_KEY: 'private-key',
    RECAPTCHA_MIN_SCORE: 0.5,
    MAIL_CONTACT_ADDRESS: 'help@example.com',
    SMTP_HOST: undefined,
    REQUIRE_CONFIRMED_EMAIL: false,
  };
  pool = createPool(config.DATABASE_URL);
  poolOff = createPool(config.DATABASE_URL);
  const { Writable } = await import('node:stream');
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logged += chunk.toString();
      done();
    },
  });
  app = await buildApp(config, pool, undefined, stream);
  off = await buildApp({ ...base, RECAPTCHA_ENABLED: false, SMTP_HOST: undefined }, poolOff);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await app.close();
  await off.close();
});

beforeEach(() => {
  logged = '';
  google.mockReset();
  vi.stubGlobal('fetch', google);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('switched off', () => {
  it('leaves the forms as they were', async () => {
    for (const url of ['/register', '/forgot-password', '/resend-confirmation']) {
      const { body } = await off.inject({ url });
      expect(body).not.toContain('captcha');
      expect(body).not.toContain('reCAPTCHA');
    }
  });

  it('asks Google nothing', async () => {
    const res = await post('/forgot-password', { login: `nobody_${run}` }, off);
    expect(res.statusCode).toBe(200);
    expect(google).not.toHaveBeenCalled();
  });
});

describe('switched on', () => {
  it.each([
    ['/register', 'register'],
    ['/forgot-password', 'forgot_password'],
    ['/resend-confirmation', 'resend_confirmation'],
  ])('puts it on %s, with the notice and only the public key', async (url, action) => {
    const { body } = await app.inject({ url });
    expect(body).toContain(`data-captcha="${action}"`);
    expect(body).toContain('data-captcha-key="public-key"');
    expect(body).toContain('name="captcha"');
    expect(body).toContain('This site is protected by reCAPTCHA.');
    expect(body).toContain('/assets/js/captcha.js');
    expect(body).not.toContain('private-key');
  });

  it('leaves the login alone', async () => {
    expect((await app.inject({ url: '/login' })).body).not.toContain('data-captcha');
  });

  it('sends Google the secret and the token', async () => {
    verdict(good);
    await forgot('the-token');

    const [url, init] = google.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      secret: 'private-key',
      response: 'the-token',
    });
  });
});

describe('the answer', () => {
  it('lets a person through', async () => {
    verdict(good);
    const res = await forgot('t');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Check your email');
  });

  it('takes a score right on the limit', async () => {
    verdict({ ...good, score: 0.5 });
    expect((await forgot('t')).statusCode).toBe(200);
  });

  it('refuses a low score, with a way out, and notes it', async () => {
    verdict({ ...good, score: 0.49 });
    const res = await forgot('t');

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('help@example.com');
    expect(logged).toContain('captcha.refused');
    expect(logged).toContain('0.49');
  });

  it('refuses a token made for another form', async () => {
    verdict({ ...good, action: 'register' });
    expect((await forgot('t')).statusCode).toBe(422);
  });

  it('refuses a token Google does not accept', async () => {
    verdict({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect((await forgot('t')).statusCode).toBe(422);
  });

  it('refuses a form with no token, without asking Google', async () => {
    expect((await forgot('')).statusCode).toBe(422);
    expect(google).not.toHaveBeenCalled();
  });
});

describe('when it is not the visitor', () => {
  it('lets people through when Google cannot be reached: a WARN', async () => {
    google.mockRejectedValue(new Error('down'));
    expect((await forgot('t')).statusCode).toBe(200);
    expect(logged).toContain('"level":40');
    expect(logged).not.toContain('"level":50');
  });

  it('does so for an error answer too', async () => {
    google.mockResolvedValue(new Response('nope', { status: 503 }));
    expect((await forgot('t')).statusCode).toBe(200);
    expect(logged).toContain('"level":40');
  });

  it('lets people through on a wrong key of ours: an ERROR', async () => {
    verdict({ success: false, 'error-codes': ['invalid-input-secret'] });
    expect((await forgot('t')).statusCode).toBe(200);
    expect(logged).toContain('"level":50');
  });
});

describe('registering', () => {
  const fields = {
    username: USER,
    email: `${USER}@example.com`,
    password: 'a long enough passphrase 7',
    confirmPassword: 'a long enough passphrase 7',
  };

  it('asks only once the form itself is right', async () => {
    const res = await post('/register', { ...fields, confirmPassword: 'other', captcha: 't' });
    expect(res.statusCode).toBe(422);
    expect(google).not.toHaveBeenCalled();
  });

  it('makes no account for a refused visitor, and keeps what was typed', async () => {
    verdict({ success: true, score: 0.1, action: 'register' });
    const res = await post('/register', { ...fields, captcha: 't' });

    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('We could not tell that you are a person');
    expect(res.body).toContain(`value="${USER}"`);
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username = $1', [USER]);
    expect(rowCount).toBe(0);
  });

  it('makes one for a person', async () => {
    verdict({ success: true, score: 0.9, action: 'register' });
    const res = await post('/register', { ...fields, captcha: 't' });

    expect(res.statusCode).toBe(302);
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE username = $1', [USER]);
    expect(rowCount).toBe(1);
  });
});

describe('the settings', () => {
  const env = { DATABASE_URL: 'postgres://x', SESSION_SECRET: 'x'.repeat(40) };

  it('are off by default, and the contact address has a default', () => {
    const parsed = loadConfig({ ...process.env, RECAPTCHA_ENABLED: '' });
    expect(parsed.RECAPTCHA_ENABLED).toBe(false);
    expect(parsed.RECAPTCHA_MIN_SCORE).toBeGreaterThanOrEqual(0);
  });

  it('refuse to start with the captcha on and no keys', () => {
    expect(() =>
      loadConfig({
        ...process.env,
        ...env,
        RECAPTCHA_ENABLED: 'true',
        RECAPTCHA_SITE_KEY: '',
        RECAPTCHA_SECRET_KEY: '',
      }),
    ).toThrow('RECAPTCHA_ENABLED=true needs');
  });
});
