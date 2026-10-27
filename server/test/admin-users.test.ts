// Admin user management against the dev database (needs `npm run db:migrate`). Emails are captured instead of sent.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { authenticate } from '../src/auth/service.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import type { MailMessage, Mailer } from '../src/mail/mailer.ts';

const run = Math.random().toString(36).slice(2, 8);
const ADMIN = `__test_admin_${run}`;
const PLAIN = `__test_plain_${run}`;
const TARGET = `__test_target_${run}`;
const NO_MAIL = `__test_nomail_${run}`;
const PASSWORD = 'correct horse';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

const sent: MailMessage[] = [];
const mailer: Mailer = { kind: 'smtp', async send(message) { sent.push(message); } };

let app: FastifyInstance;
let pool: Pool;
let ids: Record<string, string> = {};
let ipCounter = 1;

/** A browser with its own IP (the rate limits are per IP). */
async function loginAs(username: string) {
  const ip = `10.7.0.${ipCounter++}`;
  const res = await app.inject({ method: 'POST', url: '/login', remoteAddress: ip, headers: FORM,
    payload: new URLSearchParams({ username, password: PASSWORD, returnUrl: '/' }).toString() });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid');
  const cookies: Record<string, string> = cookie ? { [cookie.name]: cookie.value } : {};
  return {
    cookies,
    get: (url: string) => app.inject({ url, remoteAddress: ip, cookies }),
    post: (url: string, payload: Record<string, string>) =>
      app.inject({ method: 'POST', url, remoteAddress: ip, cookies, headers: FORM, payload: new URLSearchParams(payload).toString() }),
  };
}

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  const hash = await hashPassword(PASSWORD);
  for (const [name, email] of [[ADMIN, `${ADMIN}@example.com`], [PLAIN, `${PLAIN}@example.com`], [TARGET, `${TARGET}@example.com`], [NO_MAIL, null]] as const) {
    const { rows } = await pool.query<{ id: string }>('INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING id', [name, hash, email]);
    ids[name] = rows[0]!.id;
  }
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = 'Admins'`, [ids[ADMIN]]);
  app = await buildApp(config, pool, mailer);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username LIKE $1', [`__test_%_${run}`]);
  await app.close(); // also ends the pool
});

const userRow = async (name: string) =>
  (await pool.query('SELECT is_locked_out, email, email_confirmed, two_factor_enabled FROM users WHERE username = $1', [name])).rows[0];

describe('access', () => {
  it('sends anonymous visitors to the login and other users to /403', async () => {
    const plain = await loginAs(PLAIN);
    for (const url of ['/admin', `/admin/users/${ids[TARGET]}`]) {
      expect((await app.inject({ url })).headers.location).toBe(`/login?returnUrl=${encodeURIComponent(url)}`);
      const res = await plain.get(url);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/403');
    }
    const res = await plain.post(`/admin/users/${ids[TARGET]}/lock`, { confirmName: TARGET });
    expect(res.headers.location).toBe('/403');
    expect((await userRow(TARGET)).is_locked_out).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/admin/users/${ids[TARGET]}/lock`, headers: FORM, payload: `confirmName=${TARGET}` })).statusCode).toBe(302);
  });
});

describe('the list', () => {
  it('finds users by part of the name or email, and escapes wildcards', async () => {
    const admin = await loginAs(ADMIN);
    const found = await admin.get(`/admin?q=${encodeURIComponent(`target_${run}`)}`);
    expect(found.statusCode).toBe(200);
    expect(found.body).toContain(`href="/admin/users/${ids[TARGET]}"`);
    expect(found.body).not.toContain(`href="/admin/users/${ids[PLAIN]}"`);
    expect(found.body).toContain('1 user');
    const wild = await admin.get(`/admin?q=${encodeURIComponent('%')}`);
    expect(wild.statusCode).toBe(200);
    expect(wild.body).not.toContain(`href="/admin/users/${ids[TARGET]}"`);
  });
});

describe('sorting the list', () => {
  const all = encodeURIComponent(`_${run}`); // matches the four test users and nobody else
  const order = (body: string) => [ADMIN, PLAIN, TARGET, NO_MAIL].map((n) => [n, body.indexOf(`href="/admin/users/${ids[n]}"`)] as const)
    .sort((a, b) => a[1] - b[1]).map(([n]) => n);

  it('orders by name by default, and either way on request', async () => {
    const admin = await loginAs(ADMIN);
    expect(order((await admin.get(`/admin?q=${all}`)).body)).toEqual([ADMIN, NO_MAIL, PLAIN, TARGET]);
    expect(order((await admin.get(`/admin?q=${all}&sort=username&dir=desc`)).body)).toEqual([TARGET, PLAIN, NO_MAIL, ADMIN]);
  });

  it('sorts by groups and by last login, newest and biggest first on a first click, never-seen last', async () => {
    const admin = await loginAs(ADMIN);
    await pool.query(`INSERT INTO groups (name, user_id) VALUES ('g1 ${run}', $1), ('g2 ${run}', $1), ('g3 ${run}', $2)`, [ids[PLAIN], ids[TARGET]]);
    await pool.query(`UPDATE users SET last_login_at = CASE username WHEN $1 THEN now() - interval '1 day' WHEN $2 THEN now() - interval '5 days'
                      WHEN $3 THEN now() ELSE NULL END WHERE username = ANY($4)`, [TARGET, PLAIN, ADMIN, [ADMIN, PLAIN, TARGET, NO_MAIL]]);
    const groups = order((await admin.get(`/admin?q=${all}&sort=groups`)).body);
    expect(groups.slice(0, 2)).toEqual([PLAIN, TARGET]); // 2 groups, then 1
    const login = order((await admin.get(`/admin?q=${all}&sort=lastLogin`)).body);
    expect(login).toEqual([ADMIN, TARGET, PLAIN, NO_MAIL]);
    expect(order((await admin.get(`/admin?q=${all}&sort=lastLogin&dir=asc`)).body)).toEqual([PLAIN, TARGET, ADMIN, NO_MAIL]);
  });

  it('sorts by roles with the few users who have roles first, in either direction', async () => {
    const admin = await loginAs(ADMIN);
    expect(order((await admin.get(`/admin?q=${all}&sort=roles`)).body)[0]).toBe(ADMIN);
    expect(order((await admin.get(`/admin?q=${all}&sort=roles&dir=desc`)).body)[0]).toBe(ADMIN);
    expect(order((await admin.get(`/admin?q=${all}&sort=roles&dir=asc`)).body)).toEqual([ADMIN, NO_MAIL, PLAIN, TARGET]); // then by name
  });

  it('marks the sorted column and links the opposite direction; unknown values mean the default order', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin?q=${all}&sort=email&dir=asc`);
    expect(res.body).toContain('aria-sort="ascending"');
    expect(res.body).toContain(`href="/admin?q=${all}&amp;sort=email&amp;dir=desc"`);
    expect(res.body).toContain('href="/admin?q=' + all + '&amp;sort=groups&amp;dir=desc"'); // first click on another column
    const bad = await admin.get(`/admin?q=${all}&sort=password_hash;drop&dir=sideways`);
    expect(bad.statusCode).toBe(200);
    expect(order(bad.body)).toEqual([ADMIN, NO_MAIL, PLAIN, TARGET]);
    expect(bad.body).not.toContain('aria-sort="descending"');
  });
});

describe('the paginator', () => {
  const q = encodeURIComponent('__test_pg_'); // the 55 users made below: two pages
  const rowsIn = (body: string) => (body.match(/<td class="fw-semibold/g) ?? []).length;

  beforeAll(async () => {
    await pool.query(`INSERT INTO users (username, password_hash) SELECT '__test_pg_' || lpad(i::text, 2, '0') || '_${run}', 'x' FROM generate_series(1, 55) i`);
  });

  it('shows the count and the first page, with First and Prev greyed out', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin?q=${q}`);
    expect(res.body).toContain('>55 users<');
    expect(rowsIn(res.body)).toBe(50);
    expect(res.body).toContain('class="form-control form-control-sm ft-page-input" type="number" name="page" min="1" max="2" value="1"');
    expect(res.body).toContain('>of 2<');
    expect(res.body.match(/class="page-item disabled"/g)).toHaveLength(2);
    expect(res.body).toContain(`href="/admin?q=${q}&amp;page=2"`);
    expect(res.body).not.toContain('Previous');
  });

  it('goes to the second page and the last page, and keeps the order', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin?q=${q}&page=2`);
    expect(rowsIn(res.body)).toBe(5);
    expect(res.body).toContain('value="2"');
    expect(res.body.match(/class="page-item disabled"/g)).toHaveLength(2); // Next and Last
    expect(res.body).toContain(`href="/admin?q=${q}" aria-label="First"`); // First = page 1 without a page parameter
    const desc = await admin.get(`/admin?q=${q}&sort=username&dir=desc&page=2`);
    expect(desc.body).toContain('name="sort" value="username"');
    expect(desc.body).toContain(`href="/admin?q=${q}&amp;sort=username&amp;dir=desc"`);
  });

  it('puts a page number outside the range back in it', async () => {
    const admin = await loginAs(ADMIN);
    const past = await admin.get(`/admin?q=${q}&page=99`);
    expect(rowsIn(past.body)).toBe(5);
    expect(past.body).toContain('value="2"');
    for (const page of ['0', '-3', 'abc']) expect((await admin.get(`/admin?q=${q}&page=${page}`)).body).toContain('value="1"');
  });

  it('has no paginator when everything fits on one page', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin?q=${encodeURIComponent(`_plain_${run}`)}&page=1&sort=email`);
    expect(res.body).not.toContain('Page number');
  });
});

describe('the user pages', () => {
  const sections = ['lock', 'reset-link', 'password', 'email', 'email-status', 'end-sessions', 'disable-2fa'];

  it('name the user in a banner, and list every section with its current value', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin/users/${ids[TARGET]}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Admin area');
    expect(res.body).toContain(`<b>${TARGET}</b>`);
    for (const slug of sections) expect(res.body).toContain(`href="/admin/users/${ids[TARGET]}/${slug}"`);
    expect(res.body).toContain('>Active<');
    expect(res.body).toContain(`>${TARGET}@example.com<`);
    expect(res.body).toContain('>Off<'); // two-factor
    expect(res.body).not.toContain('confirmName'); // the forms are on the section pages
  });

  it('have one form each, with the typed-name field, and the list stays at the left', async () => {
    const admin = await loginAs(ADMIN);
    for (const slug of sections.filter((x) => x !== 'disable-2fa')) { // that one has no form while two-factor is off
      const res = await admin.get(`/admin/users/${ids[TARGET]}/${slug}`);
      expect(res.statusCode, slug).toBe(200);
      expect(res.body.match(/<form method="post" action="\/admin\/users\//g), slug).toHaveLength(1);
      expect(res.body.match(/name="confirmName"/g), slug).toHaveLength(1);
      expect(res.body).toContain('ft-settings-list'); // the list of sections
      expect(res.body).toContain('Admin area');
    }
    const off = await admin.get(`/admin/users/${ids[TARGET]}/disable-2fa`);
    expect(off.body).toContain('not on for this user');
    expect(off.body).not.toContain('confirmName');
  });

  it('show the current email address in a read-only field on the email page', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin/users/${ids[TARGET]}/email`);
    expect(res.body).toContain(`id="current-email" class="form-control" type="text" value="${TARGET}@example.com" readonly`);
    expect((await admin.get(`/admin/users/${ids[NO_MAIL]}/email`)).body).toContain('value="not set" readonly');
  });

  it('give the email and password forms the standard live tips, and no other page loads the script', async () => {
    const admin = await loginAs(ADMIN);
    const email = (await admin.get(`/admin/users/${ids[TARGET]}/email`)).body;
    expect(email).toContain('data-live-validate');
    expect(email).toContain(`data-current-email="${TARGET}@example.com"`);
    expect(email).toContain('data-hints="email"');
    expect(email).toContain('This is their current email address');
    expect(email).toContain('live-hints.js');
    const password = (await admin.get(`/admin/users/${ids[TARGET]}/password`)).body;
    expect(password).toContain('data-live-validate');
    expect(password).toContain('data-min-password="6"');
    expect(password).toContain(`data-forbidden="${TARGET},${TARGET}@example.com"`);
    expect(password).toContain('data-hints="password"');
    expect(password).toContain('data-hints="confirmPassword"');
    expect(password).toContain('not be the same as their username or email');
    expect((await admin.get(`/admin/users/${ids[TARGET]}/lock`)).body).not.toContain('live-hints.js');
  });

  it('show Unlock instead of Lock for a locked user', async () => {
    const admin = await loginAs(ADMIN);
    await pool.query('UPDATE users SET is_locked_out = true WHERE id = $1', [ids[NO_MAIL]]);
    const res = await admin.get(`/admin/users/${ids[NO_MAIL]}/lock`);
    expect(res.body).toContain(`action="/admin/users/${ids[NO_MAIL]}/unlock"`);
    expect((await admin.get(`/admin/users/${ids[NO_MAIL]}`)).body).toContain('>Locked<');
    await pool.query('UPDATE users SET is_locked_out = false WHERE id = $1', [ids[NO_MAIL]]);
  });

  it('have no forms for the admin\'s own account', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin/users/${ids[ADMIN]}`);
    expect(res.body).toContain('This is your own account');
    expect(res.body).not.toContain('confirmName');
    expect(res.body).not.toContain('ft-settings-list');
    expect((await admin.get(`/admin/users/${ids[ADMIN]}/password`)).headers.location).toBe(`/admin/users/${ids[ADMIN]}`);
    const post = await admin.post(`/admin/users/${ids[ADMIN]}/lock`, { confirmName: ADMIN });
    expect(post.statusCode).toBe(302);
    expect((await userRow(ADMIN)).is_locked_out).toBe(false);
  });

  it('go back to the list or the user when something is unknown', async () => {
    const admin = await loginAs(ADMIN);
    expect((await admin.get('/admin/users/not-a-uuid')).headers.location).toBe('/admin');
    expect((await admin.get('/admin/users/00000000-0000-4000-8000-000000000000')).headers.location).toBe('/admin');
    expect((await admin.get('/admin/users/00000000-0000-4000-8000-000000000000/password')).headers.location).toBe('/admin');
    expect((await admin.get(`/admin/users/${ids[TARGET]}/nonsense`)).headers.location).toBe(`/admin/users/${ids[TARGET]}`);
    expect((await admin.get(`/admin/users/${ids[TARGET]}/unlock`)).headers.location).toBe(`/admin/users/${ids[TARGET]}`); // only POST
  });

  it('send a failed change back to its own page, and a successful one too', async () => {
    const admin = await loginAs(ADMIN);
    const bad = await admin.post(`/admin/users/${ids[TARGET]}/end-sessions`, { confirmName: 'x' });
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('Log out everywhere</h1>'); // the section page, with the list at the left
    expect(bad.body).toContain('ft-settings-list');
    const ok = await admin.post(`/admin/users/${ids[TARGET]}/end-sessions`, { confirmName: TARGET });
    expect(ok.headers.location).toBe(`/admin/users/${ids[TARGET]}/end-sessions`);
  });
});

describe('changes', () => {
  it('lock and unlock need the typed name; locking logs the user out', async () => {
    const admin = await loginAs(ADMIN);
    const victim = await loginAs(TARGET);
    expect((await victim.get('/account')).statusCode).toBe(200);

    const wrong = await admin.post(`/admin/users/${ids[TARGET]}/lock`, { confirmName: 'somebody else' });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.body).toContain('exactly');
    expect((await userRow(TARGET)).is_locked_out).toBe(false);

    const ok = await admin.post(`/admin/users/${ids[TARGET]}/lock`, { confirmName: ` ${TARGET.toUpperCase()} ` });
    expect(ok.statusCode).toBe(302);
    expect((await userRow(TARGET)).is_locked_out).toBe(true);
    expect((await victim.get('/account')).statusCode).toBe(302); // session is gone
    expect(await authenticate(pool, TARGET, PASSWORD)).toBeNull();
    expect((await admin.get(`/admin/users/${ids[TARGET]}`)).body).toContain('Unlock');

    const back = await admin.post(`/admin/users/${ids[TARGET]}/unlock`, { confirmName: TARGET });
    expect(back.statusCode).toBe(302);
    expect((await userRow(TARGET)).is_locked_out).toBe(false);
    expect(await authenticate(pool, TARGET, PASSWORD)).not.toBeNull();
  });

  it('sets a password after checking it, logs the user out and tells them', async () => {
    const admin = await loginAs(ADMIN);
    const victim = await loginAs(TARGET);
    const url = `/admin/users/${ids[TARGET]}/password`;

    const mismatch = await admin.post(url, { password: 'new password 1', confirmPassword: 'other', confirmName: TARGET });
    expect(mismatch.statusCode).toBe(422);
    const noName = await admin.post(url, { password: 'new password 1', confirmPassword: 'new password 1', confirmName: '' });
    expect(noName.statusCode).toBe(422);
    expect(await authenticate(pool, TARGET, PASSWORD)).not.toBeNull();

    sent.length = 0;
    const ok = await admin.post(url, { password: 'new password 1', confirmPassword: 'new password 1', confirmName: TARGET });
    expect(ok.statusCode).toBe(302);
    expect(await authenticate(pool, TARGET, 'new password 1')).not.toBeNull();
    expect(await authenticate(pool, TARGET, PASSWORD)).toBeNull();
    expect((await victim.get('/account')).statusCode).toBe(302);
    await app.mail.flush();
    expect(sent.some((m) => m.to === `${TARGET}@example.com`)).toBe(true);
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [ids[TARGET], await hashPassword(PASSWORD)]); // for the next tests
  });

  it('sends a reset link, and refuses for a user without an email', async () => {
    const admin = await loginAs(ADMIN);
    sent.length = 0;
    const ok = await admin.post(`/admin/users/${ids[TARGET]}/reset-link`, { confirmName: TARGET });
    expect(ok.statusCode).toBe(302);
    await app.mail.flush();
    expect(sent.find((m) => m.to === `${TARGET}@example.com`)?.text).toContain('/reset-password?token=');

    sent.length = 0;
    const none = await admin.post(`/admin/users/${ids[NO_MAIL]}/reset-link`, { confirmName: NO_MAIL });
    expect(none.statusCode).toBe(422);
    expect(none.body).toContain('no email address');
    expect(sent).toHaveLength(0);
  });

  it('asks the new address to confirm an email change, and rejects taken addresses', async () => {
    const admin = await loginAs(ADMIN);
    const url = `/admin/users/${ids[TARGET]}/email`;
    const taken = await admin.post(url, { email: `${PLAIN}@example.com`, confirmName: TARGET });
    expect(taken.statusCode).toBe(422);
    expect(taken.body).toContain('already registered');

    sent.length = 0;
    const next = `${TARGET}.new@example.com`;
    const ok = await admin.post(url, { email: next, confirmName: TARGET });
    expect(ok.statusCode).toBe(302);
    await app.mail.flush();
    expect(sent.find((m) => m.to === next)?.text).toContain('token=');
    expect((await userRow(TARGET)).email).toBe(`${TARGET}@example.com`); // unchanged until the link is opened
  });

  it('marks the email confirmed or not', async () => {
    const admin = await loginAs(ADMIN);
    const url = `/admin/users/${ids[TARGET]}/email-status`;
    expect((await admin.post(url, { to: 'no', confirmName: TARGET })).statusCode).toBe(302);
    expect((await userRow(TARGET)).email_confirmed).toBe(false);
    expect((await admin.post(url, { to: 'yes', confirmName: TARGET })).statusCode).toBe(302);
    expect((await userRow(TARGET)).email_confirmed).toBe(true);
    expect((await admin.post(`/admin/users/${ids[NO_MAIL]}/email-status`, { to: 'yes', confirmName: NO_MAIL })).statusCode).toBe(422);
  });

  it('ends sessions', async () => {
    const admin = await loginAs(ADMIN);
    const victim = await loginAs(TARGET);
    expect((await victim.get('/account')).statusCode).toBe(200);
    expect((await admin.post(`/admin/users/${ids[TARGET]}/end-sessions`, { confirmName: TARGET })).statusCode).toBe(302);
    expect((await victim.get('/account')).statusCode).toBe(302);
  });

  it('turns two-factor login off only when it is on', async () => {
    const admin = await loginAs(ADMIN);
    const url = `/admin/users/${ids[TARGET]}/disable-2fa`;
    expect((await admin.post(url, { confirmName: TARGET })).statusCode).toBe(422);

    await pool.query(`UPDATE users SET two_factor_enabled = true, two_factor_secret = 'JBSWY3DPEHPK3PXP' WHERE id = $1`, [ids[TARGET]]);
    expect((await admin.get(`/admin/users/${ids[TARGET]}/disable-2fa`)).body).toContain('Turn off for');
    expect((await admin.get(`/admin/users/${ids[TARGET]}`)).body).toContain('>On<');
    expect((await admin.post(url, { confirmName: 'nope' })).statusCode).toBe(422);
    expect((await userRow(TARGET)).two_factor_enabled).toBe(true);
    expect((await admin.post(url, { confirmName: TARGET })).statusCode).toBe(302);
    expect((await userRow(TARGET)).two_factor_enabled).toBe(false);
  });
});
