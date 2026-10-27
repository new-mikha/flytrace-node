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

describe('the user page', () => {
  it('names the user in a banner and has a confirmation field in every form', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin/users/${ids[TARGET]}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Admin area');
    expect(res.body).toContain(`<b>${TARGET}</b>`);
    const forms = res.body.match(/<form method="post" action="\/admin\/users\//g)!.length;
    expect(res.body.match(/name="confirmName"/g)!.length).toBe(forms);
    expect(res.body).not.toContain('Turn off two-factor login'); // it is not on for this user
  });

  it('has no forms for the admin\'s own account', async () => {
    const admin = await loginAs(ADMIN);
    const res = await admin.get(`/admin/users/${ids[ADMIN]}`);
    expect(res.body).toContain('This is your own account');
    expect(res.body).not.toContain('confirmName');
    const post = await admin.post(`/admin/users/${ids[ADMIN]}/lock`, { confirmName: ADMIN });
    expect(post.statusCode).toBe(302);
    expect((await userRow(ADMIN)).is_locked_out).toBe(false);
  });

  it('goes back to the list for an unknown user', async () => {
    const admin = await loginAs(ADMIN);
    expect((await admin.get('/admin/users/not-a-uuid')).headers.location).toBe('/admin');
    expect((await admin.get('/admin/users/00000000-0000-4000-8000-000000000000')).headers.location).toBe('/admin');
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
    expect((await admin.get(`/admin/users/${ids[TARGET]}`)).body).toContain('Turn off two-factor login');
    expect((await admin.post(url, { confirmName: 'nope' })).statusCode).toBe(422);
    expect((await userRow(TARGET)).two_factor_enabled).toBe(true);
    expect((await admin.post(url, { confirmName: TARGET })).statusCode).toBe(302);
    expect((await userRow(TARGET)).two_factor_enabled).toBe(false);
  });
});
