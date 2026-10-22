// Registration, email confirmation, password reset, account pages and two-factor login, end to end against the dev database
// (needs `npm run db:migrate`). Emails are captured instead of sent.
import type { FastifyInstance } from 'fastify';
import * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import type { MailMessage, Mailer } from '../src/mail/mailer.ts';

const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct horse battery';
let ipCounter = 10;

const sent: MailMessage[] = [];
let failMail = false;
const mailer: Mailer = {
  kind: 'smtp',
  async send(message) {
    if (failMail) throw new Error('connection refused');
    sent.push(message);
  },
};

function tokenIn(message: MailMessage | undefined): string {
  const match = message?.text.match(/token=([^\s&"]+)/);
  if (!match) throw new Error(`no link in: ${message?.text}`);
  return decodeURIComponent(match[1]!);
}

/** A browser: keeps cookies, has its own IP so the per-IP rate limits of one test do not hit another. */
class Browser {
  cookies: Record<string, string> = {};
  readonly ip = `10.1.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
  constructor(private readonly app: FastifyInstance) {}

  async request(method: 'GET' | 'POST', url: string, form?: Record<string, string>) {
    const res = await this.app.inject({
      method, url, remoteAddress: this.ip, cookies: this.cookies,
      ...(form ? { payload: new URLSearchParams(form).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}),
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.expires && c.expires.getTime() < Date.now())) delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }
  get = (url: string) => this.request('GET', url);
  post = (url: string, form: Record<string, string>) => this.request('POST', url, form);

  async loginAs(username: string, password = PASSWORD) {
    return this.post('/login', { username, password, returnUrl: '/account' });
  }
  async whoami(): Promise<string | null> {
    const res = await this.app.inject({ url: '/account', cookies: this.cookies, remoteAddress: this.ip });
    return res.statusCode === 200 ? (res.body.match(/Username<\/dt><dd[^>]*>([^<]+)</)?.[1] ?? null) : null;
  }
}

function totp(secret: string, offsetSteps = 0): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 })
    .generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

let pool: Pool;
let config: Config;
let app: FastifyInstance;
let strictApp: FastifyInstance; // confirmation required

async function build(overrides: Partial<Config>): Promise<FastifyInstance> {
  return buildApp({ ...config, ...overrides }, createPool(config.DATABASE_URL), mailer);
}

beforeAll(async () => {
  config = { ...loadConfig(), REQUIRE_CONFIRMED_EMAIL: false, SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  app = await build({});
  strictApp = await build({ REQUIRE_CONFIRMED_EMAIL: true });
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`__idt_%_${run}`]);
  await pool.end();
  await app.close();
  await strictApp.close();
});

const register = (b: Browser, name: string, extra: Record<string, string> = {}) =>
  b.post('/register', {
    username: `__idt_${name}_${run}`, email: `idt_${name}_${run}@example.test`,
    password: PASSWORD, confirmPassword: PASSWORD, ...extra,
  });
const userName = (name: string) => `__idt_${name}_${run}`;
const userEmail = (name: string) => `idt_${name}_${run}@example.test`;

describe('registration', () => {
  it('shows the form and rejects bad input with messages', async () => {
    const b = new Browser(app);
    const page = await b.get('/register');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="username"');

    const bad = await b.post('/register', { username: 'a@b.test', email: 'nope', password: 'short', confirmPassword: 'other' });
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('letters, digits');
    expect(bad.body).toContain('valid email');
    expect(bad.body).toContain('at least 6');

    const mismatch = await register(b, 'x1', { confirmPassword: 'different password' });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.body).toContain('do not match');
    expect(sent).toHaveLength(0);
  });

  it('creates an unconfirmed account, logs in, and emails a confirmation link', async () => {
    const b = new Browser(app);
    const res = await register(b, 'reg');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/account');
    expect(await b.whoami()).toBe(userName('reg'));

    await app.mail.flush();
    const mail = sent.at(-1)!;
    expect(mail.to).toBe(userEmail('reg'));
    expect(mail.subject).toContain('Confirm');
    expect(mail.html).toContain('/confirm-email?token=');

    const row = (await pool.query('SELECT email_confirmed FROM users WHERE username = $1', [userName('reg')])).rows[0];
    expect(row.email_confirmed).toBe(false);
    expect((await b.get('/account')).body).toContain('not confirmed');
  });

  it('confirms through a button, not by merely opening the link, and only once', async () => {
    const token = tokenIn(sent.at(-1));
    const b = new Browser(app);
    const open = await b.get(`/confirm-email?token=${encodeURIComponent(token)}`);
    expect(open.statusCode).toBe(200);
    expect(open.body).toContain('Confirm my email');
    expect((await pool.query('SELECT email_confirmed FROM users WHERE username = $1', [userName('reg')])).rows[0].email_confirmed).toBe(false);

    const done = await b.post('/confirm-email', { token });
    expect(done.statusCode).toBe(302);
    expect((await pool.query('SELECT email_confirmed FROM users WHERE username = $1', [userName('reg')])).rows[0].email_confirmed).toBe(true);

    expect((await b.get(`/confirm-email?token=${encodeURIComponent(token)}`)).statusCode).toBe(400); // used up
    expect((await b.get('/confirm-email?token=garbage')).statusCode).toBe(400);
  });

  it('refuses a taken username or email, ignoring case', async () => {
    const b = new Browser(app);
    const sameName = await b.post('/register', { username: userName('reg').toUpperCase(), email: userEmail('other'), password: PASSWORD, confirmPassword: PASSWORD });
    expect(sameName.statusCode).toBe(409);
    expect(sameName.body).toContain('username is taken');
    const sameEmail = await b.post('/register', { username: userName('other'), email: userEmail('reg').toUpperCase(), password: PASSWORD, confirmPassword: PASSWORD });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.body).toContain('already registered');
  });

  it('does not allow an email that is somebody else\'s username', async () => {
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ($1, 'x')`, [`__idt_legacy_${run}`]);
    const b = new Browser(app);
    const res = await b.post('/register', { username: userName('lg'), email: `__idt_legacy_${run}`, password: PASSWORD, confirmPassword: PASSWORD });
    expect(res.statusCode).toBe(422); // not an email address at all
  });
});

describe('mandatory email confirmation', () => {
  it('blocks login until the link is used', async () => {
    const b = new Browser(strictApp);
    const res = await register(b, 'strict');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Check your email');
    expect(await b.whoami()).toBeNull();

    const blocked = await b.loginAs(userName('strict'));
    expect(blocked.headers.location).toContain('error=unconfirmed');
    expect(await b.whoami()).toBeNull();

    await strictApp.mail.flush();
    expect((await b.post('/confirm-email', { token: tokenIn(sent.at(-1)) })).statusCode).toBe(302);
    expect((await b.loginAs(userName('strict'))).headers.location).toBe('/account');
    expect(await b.whoami()).toBe(userName('strict'));
  });

  it('resends the link, with the same answer for unknown accounts', async () => {
    const b = new Browser(strictApp);
    await register(b, 'resend');
    await strictApp.mail.flush();
    const before = sent.length;
    const known = await b.post('/resend-confirmation', { login: userName('resend') });
    const unknown = await b.post('/resend-confirmation', { login: userName('nobody') });
    expect(known.statusCode).toBe(200);
    expect(unknown.body).toBe(known.body);
    await strictApp.mail.flush();
    expect(sent.length).toBe(before + 1);
    // the newest link replaces the older one
    const [older, newer] = [tokenIn(sent[before - 1]), tokenIn(sent[before])];
    expect((await b.get(`/confirm-email?token=${encodeURIComponent(older)}`)).statusCode).toBe(400);
    expect((await b.get(`/confirm-email?token=${encodeURIComponent(newer)}`)).statusCode).toBe(200);
  });
});

describe('forgot and reset password', () => {
  it('emails a one-time link and sets the new password', async () => {
    const victim = new Browser(app);
    await register(victim, 'reset');
    const otherDevice = new Browser(app);
    await otherDevice.loginAs(userName('reset'));
    expect(await otherDevice.whoami()).toBe(userName('reset'));

    const b = new Browser(app);
    const asked = await b.post('/forgot-password', { login: userEmail('reset') });
    const unknown = await b.post('/forgot-password', { login: 'nobody_' + run });
    expect(asked.statusCode).toBe(200);
    expect(unknown.body).toBe(asked.body);
    await app.mail.flush();
    const mail = sent.filter((m) => m.subject.includes('Reset')).at(-1)!;
    expect(mail.to).toBe(userEmail('reset'));
    const token = tokenIn(mail);

    const resetPage = await b.get(`/reset-password?token=${encodeURIComponent(token)}`);
    expect(resetPage.statusCode).toBe(200);
    expect(resetPage.body).toContain('data-hints="password"'); // the same live hints as on the register page
    expect(resetPage.body).toContain('ft-pw-toggle'); // show / hide password button
    expect(resetPage.body).toContain(`data-forbidden="${userName('reset')},${userEmail('reset')}"`);
    const weak = await b.post('/reset-password', { token, password: 'short', confirmPassword: 'short' });
    expect(weak.statusCode).toBe(422);
    const done = await b.post('/reset-password', { token, password: 'brand new password', confirmPassword: 'brand new password' });
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toBe('/login');

    expect(await otherDevice.whoami()).toBeNull(); // old sessions are ended
    expect((await new Browser(app).loginAs(userName('reset'))).headers.location).toContain('error=');
    const fresh = new Browser(app);
    expect((await fresh.loginAs(userName('reset'), 'brand new password')).headers.location).toBe('/account');
    expect((await b.get(`/reset-password?token=${encodeURIComponent(token)}`)).statusCode).toBe(400); // single use
  });
});

describe('account pages', () => {
  it('require login', async () => {
    const res = await new Browser(app).get('/account/password');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/login');
  });

  it('change the password, ending other sessions but not the current one', async () => {
    const b = new Browser(app);
    await register(b, 'pw');
    const form = (await b.get('/account/password')).body;
    expect(form).toContain('data-hints="password"');
    expect(form).toContain('data-hints="confirmPassword"');
    expect((await b.get('/account/email')).body).toContain('data-hints="email"');
    const other = new Browser(app);
    await other.loginAs(userName('pw'));

    const wrong = await b.post('/account/password', { currentPassword: 'nope', password: 'another good one', confirmPassword: 'another good one' });
    expect(wrong.statusCode).toBe(422);
    const ok = await b.post('/account/password', { currentPassword: PASSWORD, password: 'another good one', confirmPassword: 'another good one' });
    expect(ok.statusCode).toBe(302);
    expect(await b.whoami()).toBe(userName('pw'));
    expect(await other.whoami()).toBeNull();
    expect((await new Browser(app).loginAs(userName('pw'), 'another good one')).headers.location).toBe('/account');
  });

  it('change the email through a link sent to the new address', async () => {
    const b = new Browser(app);
    await register(b, 'em');
    const newEmail = `idt_em_new_${run}@example.test`;
    const taken = await b.post('/account/email', { email: userEmail('reg'), currentPassword: PASSWORD });
    expect(taken.statusCode).toBe(422);
    expect((await b.post('/account/email', { email: newEmail, currentPassword: 'wrong' })).statusCode).toBe(422);
    expect((await b.post('/account/email', { email: newEmail, currentPassword: PASSWORD })).statusCode).toBe(302);
    await app.mail.flush();
    const mail = sent.at(-1)!;
    expect(mail.to).toBe(newEmail);
    expect((await pool.query('SELECT email FROM users WHERE username = $1', [userName('em')])).rows[0].email).toBe(userEmail('em'));

    expect((await b.post('/confirm-email-change', { token: tokenIn(mail) })).statusCode).toBe(302);
    const row = (await pool.query('SELECT email, email_confirmed FROM users WHERE username = $1', [userName('em')])).rows[0];
    expect(row).toEqual({ email: newEmail, email_confirmed: true });
  });

  it('send a test email, and report a failure', async () => {
    const b = new Browser(app);
    await register(b, 'test');
    const before = sent.length;
    const ok = await b.post('/account/test-email', {});
    expect(ok.statusCode).toBe(302);
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.subject).toContain('Test email');
    expect((await b.get('/account')).body).toContain('Test email sent');

    failMail = true;
    try {
      await b.post('/account/test-email', {});
      expect((await b.get('/account')).body).toContain('could not be sent');
    } finally { failMail = false; }
  });

  it('download the personal data and delete the account', async () => {
    const b = new Browser(app);
    await register(b, 'del');
    const data = await b.get('/account/personal-data/download');
    expect(data.headers['content-disposition']).toContain('attachment');
    const json = data.json();
    expect(json.account.username).toBe(userName('del'));
    expect(JSON.stringify(json)).not.toContain('argon2');

    expect((await b.post('/account/delete', { currentPassword: PASSWORD })).statusCode).toBe(422); // box not ticked
    expect((await b.post('/account/delete', { currentPassword: 'wrong', confirm: 'yes' })).statusCode).toBe(422);
    expect((await b.post('/account/delete', { currentPassword: PASSWORD, confirm: 'yes' })).statusCode).toBe(302);
    expect((await pool.query('SELECT 1 FROM users WHERE username = $1', [userName('del')])).rowCount).toBe(0);
    expect(await b.whoami()).toBeNull();
  });
});

describe('two-factor login', () => {
  async function enable(name: string) {
    const b = new Browser(app);
    await register(b, name);
    const setup = await b.get('/account/2fa/setup');
    expect(setup.body).toContain('<svg');
    const secret = setup.body.match(/user-select-all">([A-Z2-7 ]+)</)![1]!.replace(/ /g, '');
    const wrong = await b.post('/account/2fa/setup', { code: '000000' });
    expect(wrong.statusCode).toBe(422);
    const enabled = await b.post('/account/2fa/setup', { code: totp(secret) });
    expect(enabled.statusCode).toBe(200);
    const codes = [...enabled.body.matchAll(/<code>([A-Z2-9]{5}-[A-Z2-9]{5})<\/code>/g)].map((m) => m[1]!);
    expect(codes).toHaveLength(10);
    return { secret, codes };
  }

  it('asks for the code after the password, and accepts each code once', async () => {
    const { secret } = await enable('mfa');
    const b = new Browser(app);
    const step1 = await b.loginAs(userName('mfa'));
    expect(step1.headers.location).toBe('/login/2fa');
    expect(await b.whoami()).toBeNull();

    expect((await b.post('/login/2fa', { code: '123456' })).statusCode).toBe(401);
    expect(await b.whoami()).toBeNull();
    // the code used while enabling is spent; the next step's code is accepted
    const next = totp(secret, 1);
    const ok = await b.post('/login/2fa', { code: next });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toBe('/account');
    expect(await b.whoami()).toBe(userName('mfa'));

    const replay = new Browser(app);
    await replay.loginAs(userName('mfa'));
    expect((await replay.post('/login/2fa', { code: next })).statusCode).toBe(401);

  });

  it('accepts a recovery code once, and locks the attempt after too many wrong codes', async () => {
    const { codes } = await enable('mfa2');
    const b = new Browser(app);
    await b.loginAs(userName('mfa2'));
    expect((await b.post('/login/recovery', { code: 'AAAAA-AAAAA' })).statusCode).toBe(401);
    const ok = await b.post('/login/recovery', { code: codes[0]!.toLowerCase() });
    expect(ok.statusCode).toBe(302);
    expect(await b.whoami()).toBe(userName('mfa2'));

    const again = new Browser(app);
    await again.loginAs(userName('mfa2'));
    expect((await again.post('/login/recovery', { code: codes[0]! })).statusCode).toBe(401);

    const guesser = new Browser(app);
    await guesser.loginAs(userName('mfa2'));
    for (let i = 0; i < 5; i++) await guesser.post('/login/2fa', { code: '111111' });
    const locked = await guesser.post('/login/2fa', { code: '111111' });
    expect(locked.headers.location).toContain('error=locked');
    expect((await guesser.get('/login/2fa')).statusCode).toBe(302);
  });

  it('regenerates recovery codes and turns off, each only with the password', async () => {
    const { codes } = await enable('mfa3');
    const b = new Browser(app);
    await b.loginAs(userName('mfa3'));
    await b.post('/login/recovery', { code: codes[1]! });

    expect((await b.post('/account/2fa/recovery-codes', { currentPassword: 'wrong' })).statusCode).toBe(422);
    const fresh = await b.post('/account/2fa/recovery-codes', { currentPassword: PASSWORD });
    expect(fresh.body).toContain('<code>');
    const newCodes = [...fresh.body.matchAll(/<code>([A-Z2-9]{5}-[A-Z2-9]{5})<\/code>/g)].map((m) => m[1]!);
    expect(newCodes).not.toContain(codes[2]);

    expect((await b.post('/account/2fa/disable', { currentPassword: 'wrong' })).statusCode).toBe(422);
    expect((await b.post('/account/2fa/disable', { currentPassword: PASSWORD })).statusCode).toBe(302);
    const plain = new Browser(app);
    expect((await plain.loginAs(userName('mfa3'))).headers.location).toBe('/account');
    expect((await pool.query(`SELECT count(*) AS n FROM recovery_codes r JOIN users u ON u.id = r.user_id WHERE u.username = $1`, [userName('mfa3')])).rows[0].n).toBe('0');
  });
});

describe('register page helpers', () => {
  it('lists the rules under each field, for the live hints', async () => {
    const page = await new Browser(app).get('/register');
    expect(page.body).toContain('data-hints="username"');
    expect(page.body).toContain('At least 3 characters');
    expect(page.body).toContain('At least 6 characters');
    expect(page.body).toContain('/assets/js/live-hints.js');
  });

  it('says whether a username or email is already taken, ignoring case', async () => {
    const owner = new Browser(app);
    await register(owner, 'chk'); // registering logs this browser in
    const b = new Browser(app); // an anonymous visitor
    const check = async (query: string) => (await b.get(`/register/check?${query}`)).json().taken;
    expect(await check(`username=${userName('chk').toUpperCase()}`)).toBe(true);
    expect(await check(`username=${userName('free')}`)).toBe(false);
    expect(await check(`email=${encodeURIComponent(userEmail('chk').toUpperCase())}`)).toBe(true);
    expect(await check(`email=${encodeURIComponent(userEmail('free'))}`)).toBe(false);
    expect(await check('username=a')).toBe(false); // invalid values are not looked up
    expect((await b.get('/register/check?username=x')).headers['cache-control']).toBe('no-store');
  });

  it('does not count the logged-in person\'s own address as taken (change-email page)', async () => {
    const owner = new Browser(app);
    await register(owner, 'own');
    await register(new Browser(app), 'other');
    const check = async (email: string) => (await owner.get(`/register/check?email=${encodeURIComponent(email)}`)).json().taken;
    expect(await check(userEmail('own'))).toBe(false);
    expect(await check(userEmail('other'))).toBe(true);
  });
});
