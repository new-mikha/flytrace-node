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

// Where the app raises alerts (`app.alerts`): a new account, an email to somebody, a crash.
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import type { MailMessage, Mailer } from '../src/mail/mailer.ts';

const run = Math.random().toString(36).slice(2, 8);
const OWNERS = ['owner@example.test'];
const NAME = `__alt_${run}`;
const EMAIL = `alt_${run}@example.test`;

const sent: MailMessage[] = [];
let failMail = false;
const mailer: Mailer = {
  kind: 'smtp',
  async send(message) {
    if (failMail && message.to !== OWNERS[0]) throw new Error('mailbox unavailable');
    sent.push(message);
  },
};

let app: FastifyInstance;
let pool: Pool;

beforeAll(async () => {
  const config = {
    ...loadConfig(),
    SMTP_HOST: undefined,
    REQUIRE_CONFIRMED_EMAIL: false,
    ALERT_EMAILS: OWNERS,
  };
  pool = createPool(config.DATABASE_URL);
  app = await buildApp(config, createPool(config.DATABASE_URL), mailer);
  app.get('/__test/crash', () => {
    throw new Error('the database is down');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  failMail = false;
  sent.length = 0;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [NAME]);
  await pool.end();
  await app.close();
});

const toOwners = () => sent.filter((m) => m.to === OWNERS[0]);

describe('alerts', () => {
  it('come once for a registration, with the address, and without the link', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/register',
      remoteAddress: '10.9.0.1',
      payload: new URLSearchParams({
        username: NAME,
        email: EMAIL,
        password: 'correct horse battery',
        confirmPassword: 'correct horse battery',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(302);
    await app.mail.flush();
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    const [alert] = toOwners();
    expect(alert!.subject).toBe(`Flytrace: New account: ${NAME}`);
    expect(alert!.text).toContain(EMAIL);
    expect(alert!.text).not.toMatch(/token|http/);
    expect(sent.filter((m) => m.to === EMAIL)).toHaveLength(1);
  });

  it('come for every email to somebody, and a failed one is throttled', async () => {
    const sendNow = vi.spyOn(app.alerts, 'sendNow');
    const throttle = vi.spyOn(app.alerts, 'throttle');
    const to = { id: '00000000-0000-0000-0000-000000000000', username: NAME, email: EMAIL };

    await app.mail.sendTest(to);
    expect(sendNow).toHaveBeenCalledWith(
      `Email to ${NAME}: Test email from Flytrace`,
      `${NAME}, ${EMAIL}: "Test email from Flytrace" sent.`,
    );

    failMail = true;
    await app.mail.sendTest(to);
    expect(sendNow).toHaveBeenCalledOnce();
    expect(throttle).toHaveBeenCalledWith(
      'smtp-failed',
      `"Test email from Flytrace" to ${NAME}, ${EMAIL}: mailbox unavailable`,
    );
  });

  it('are throttled for a crash, with the path but not the query', async () => {
    const throttle = vi.spyOn(app.alerts, 'throttle');
    const res = await app.inject({ url: '/__test/crash?token=secret' });

    expect(res.statusCode).toBe(500);
    expect(throttle).toHaveBeenCalledOnce();
    const [type, message] = throttle.mock.calls[0]!;
    expect(type).toBe('server-error');
    expect(message).toMatch(/^GET \/__test\/crash 500: Error: the database is down\n/);
    expect(message).not.toContain('secret');
  });
});
