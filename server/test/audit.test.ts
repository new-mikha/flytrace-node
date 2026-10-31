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

// Action logging: who did what ends up in the log, and secrets do not.
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { audit, maskEmail } from '../src/audit.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import type { Mailer } from '../src/mail/mailer.ts';

describe('maskEmail', () => {
  it('keeps the first letter and the domain only', () => {
    expect(maskEmail('ann.smith@gmail.com')).toBe('a***@gmail.com');
    expect(maskEmail('nonsense')).toBe('***');
  });
});

describe('audit', () => {
  it('logs the event with the logged-in user, and lets details override the user', () => {
    const lines: [object, string][] = [];
    const request = {
      log: { info: (o: object, m: string) => lines.push([o, m]) },
      user: { id: 'u1', username: 'ann', roles: [] },
    };
    audit(request as never, 'group.renamed', 'Renamed group 5', { groupId: 5 });
    audit(request as never, 'login.success', 'Logged in', { user: 'bob' });
    expect(lines[0]).toEqual([
      { event: 'group.renamed', user: 'ann', userId: 'u1', groupId: 5 },
      'Renamed group 5',
    ]);
    expect(lines[1]![0]).toMatchObject({ user: 'bob' });
  });
});

describe('what the app logs', () => {
  const run = Math.random().toString(36).slice(2, 8);
  const name = `__aud_${run}`;
  const email = `ann.aud_${run}@example.test`;
  const password = `pw-secret-${run}`;
  const written: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      written.push(String(chunk));
      done();
    },
  });
  const mailer: Mailer = { kind: 'smtp', async send() {/* sent */} };
  let app: FastifyInstance;
  let pool: Pool;
  let cookies: Record<string, string> = {};
  let ip = 0;

  const events = () =>
    written.join('').split('\n').filter(Boolean).map((l) =>
      JSON.parse(l) as Record<string, unknown>
    )
      .filter((l) => l.event);

  async function post(url: string, form: Record<string, string>) {
    const res = await app.inject({
      method: 'POST',
      url,
      cookies,
      remoteAddress: `10.3.0.${++ip}`,
      payload: new URLSearchParams(form).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    for (const c of res.cookies)
      cookies[c.name] = c.value;
    return res;
  }

  beforeAll(async () => {
    const config = { ...loadConfig(), REQUIRE_CONFIRMED_EMAIL: false, SMTP_HOST: undefined };
    pool = createPool(config.DATABASE_URL);
    app = await buildApp(config, pool, mailer, sink);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE username = $1', [name]);
    await app.close(); // also ends the pool
  });

  it('records registration, a test email, a password change and failed logins with the user', async () => {
    await post('/register', { username: name, email, password, confirmPassword: password });
    await post('/account/test-email', {});
    await app.mail.flush();
    await post('/account/password', {
      currentPassword: 'wrong-' + password,
      password: 'brand-new-' + run,
      confirmPassword: 'brand-new-' + run,
    });
    await post('/account/password', {
      currentPassword: password,
      password: 'brand-new-' + run,
      confirmPassword: 'brand-new-' + run,
    });
    cookies = {};
    await post('/login', { username: name, password: 'nope', returnUrl: '/' });

    const log = events();
    const byEvent = (e: string) => log.filter((l) => l.event === e);
    expect(byEvent('register.created')[0]).toMatchObject({ user: name });
    const sent = byEvent('email.sent').find((l) => String(l.subject).startsWith('Test email'));
    expect(sent).toMatchObject({ user: name, to: `a***@example.test` });
    expect(byEvent('reauth.failed')[0]).toMatchObject({ user: name, action: 'change password' });
    expect(byEvent('password.changed')[0]).toMatchObject({ user: name });
    expect(byEvent('login.failed')[0]).toMatchObject({ ip: expect.any(String) });
  });

  it('never writes passwords, tokens, typed login names or full email addresses', () => {
    const everything = written.join('');
    expect(everything).not.toContain(password);
    expect(everything).not.toContain('brand-new-' + run);
    expect(everything).not.toContain(email);
    expect(everything).not.toMatch(/token=/);
    const failed = events().find((l) => l.event === 'login.failed')!;
    expect(JSON.stringify(failed)).not.toContain(name);
  });

  it('shows the user on every page request line', () => {
    const lines = written.join('').split('\n').filter(Boolean).map((l) =>
      JSON.parse(l) as Record<string, unknown>
    );
    const account = lines.find((l) => String(l.msg).startsWith('POST /account/test-email'));
    expect(account).toMatchObject({ user: name });
  });
});
