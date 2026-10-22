// The logged-in "My account" pages: profile, email, password, two-factor login, personal data.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  canUseEmail, checkCurrentPassword, deleteAccount, disableTwoFactor, emailSchema, enableTwoFactor, exportPersonalData,
  getAccount, setPassword,
} from '../auth/accounts.ts';
import { requireLogin } from '../auth/guards.ts';
import { countRecoveryCodes, checkCode, newSecret, provisioningUri, qrSvg, replaceRecoveryCodes } from '../auth/totp.ts';
import type { Config } from '../config.ts';
import type { Pool } from '../db.ts';
import type { MailService } from '../mail/service.ts';
import {
  EmailPage, PasswordPage, PersonalDataPage, ProfilePage, RecoveryCodesPage, TwoFactorPage, TwoFactorSetupPage,
} from '../views/AccountPages.tsx';
import { sendHtml } from '../views/render.tsx';
import { passwordErrors } from './identity.tsx';
import { emailRateLimit, formFields, setFlash, strictRateLimit, takeFlash } from './util.ts';

export async function accountRoutes(app: FastifyInstance, pool: Pool, config: Config, mail: MailService): Promise<void> {
  const guard = { preHandler: requireLogin };
  const common = (request: FastifyRequest) => ({ user: request.user!, path: request.url.split('?')[0]!, flash: takeFlash(request) });
  const accountOf = async (request: FastifyRequest) => (await getAccount(pool, request.user!.id))!;
  const recipientOf = (a: { id: string; username: string; email: string | null }) =>
    a.email ? { id: a.id, username: a.username, email: a.email } : null;

  // ---- profile ----

  app.get('/account', guard, async (request, reply) =>
    sendHtml(reply, <ProfilePage {...common(request)} account={await accountOf(request)} mailKind={mail.mailer.kind} />));

  app.post('/account/resend-confirmation', { ...guard, config: emailRateLimit }, async (request, reply) => {
    const to = recipientOf(await accountOf(request));
    if (!to) setFlash(request, 'danger', 'Your account has no email address.');
    else {
      mail.queue(() => mail.sendConfirmEmail(to));
      setFlash(request, 'success', `Confirmation email sent to ${to.email}.`);
    }
    return reply.redirect('/account', 302);
  });

  // The test email is sent right away (not in the background) so that the page can say what happened.
  app.post('/account/test-email', { ...guard, config: emailRateLimit }, async (request, reply) => {
    const to = recipientOf(await accountOf(request));
    if (!to) {
      setFlash(request, 'danger', 'Your account has no email address.');
    } else if (mail.mailer.kind === 'log') {
      await mail.sendTest(to);
      setFlash(request, 'info', 'Outgoing email is not set up on this server (no SMTP_HOST), so the test message was only written to the server log.');
    } else {
      const result = await mail.sendTest(to);
      const detail = request.user!.roles.includes('Admins') && result.error ? ` (${result.error})` : '';
      if (result.ok) setFlash(request, 'success', `Test email sent to ${to.email}. Check your inbox, and the spam folder.`);
      else setFlash(request, 'danger', `The test email could not be sent${detail}. The error is in the server log.`);
    }
    return reply.redirect('/account', 302);
  });

  // ---- email ----

  app.get('/account/email', guard, async (request, reply) =>
    sendHtml(reply, <EmailPage {...common(request)} account={await accountOf(request)} errors={{}} />));

  app.post('/account/email', { ...guard, config: emailRateLimit }, async (request, reply) => {
    const f = formFields(request, 'email', 'currentPassword');
    const account = await accountOf(request);
    const email = f.email.trim();
    const errors: Record<string, string | undefined> = {};
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) errors.email = parsed.error.issues[0]?.message;
    else if (account.email?.toLowerCase() === email.toLowerCase()) errors.email = 'This is already your email address.';
    else if (!(await canUseEmail(pool, email, account.id))) errors.email = 'This email address is already registered.';
    if (!errors.email && !(await checkCurrentPassword(pool, account.id, f.currentPassword))) errors.currentPassword = 'Wrong password.';
    if (errors.email || errors.currentPassword) {
      return sendHtml(reply, <EmailPage {...common(request)} account={account} errors={errors} value={email} />, 422);
    }
    mail.queue(() => mail.sendChangeEmail({ id: account.id, username: account.username, email }, email));
    setFlash(request, 'success', `We sent a confirmation link to ${email}. Your address changes when you open it.`);
    return reply.redirect('/account/email', 302);
  });

  // ---- password ----

  app.get('/account/password', guard, async (request, reply) =>
    sendHtml(reply, <PasswordPage {...common(request)} errors={{}} />));

  app.post('/account/password', { ...guard, config: strictRateLimit }, async (request, reply) => {
    const f = formFields(request, 'currentPassword', 'password', 'confirmPassword');
    const account = await accountOf(request);
    const errors: Record<string, string | undefined> = passwordErrors(f.password, f.confirmPassword, [account.username, account.email ?? '']);
    if (!(await checkCurrentPassword(pool, account.id, f.currentPassword))) errors.currentPassword = 'Wrong password.';
    if (Object.values(errors).some(Boolean)) return sendHtml(reply, <PasswordPage {...common(request)} errors={errors} />, 422);

    await setPassword(pool, account.id, f.password, request.session.sessionId); // other devices are logged out
    const to = recipientOf(account);
    if (to) mail.queue(() => mail.sendPasswordChanged(to));
    setFlash(request, 'success', 'Your password is changed.');
    return reply.redirect('/account/password', 302);
  });

  // ---- two-factor ----

  app.get('/account/2fa', guard, async (request, reply) => {
    const account = await accountOf(request);
    return sendHtml(reply, <TwoFactorPage {...common(request)} account={account}
      recoveryLeft={account.twoFactorEnabled ? await countRecoveryCodes(pool, account.id) : 0} errors={{}} />);
  });

  async function setupPage(request: FastifyRequest, reply: Parameters<typeof sendHtml>[0], error?: string) {
    const account = await accountOf(request);
    const secret = (request.session.pendingTotpSecret ??= newSecret());
    const svg = await qrSvg(provisioningUri(secret, 'FlyTrace', account.email ?? account.username));
    return sendHtml(reply, <TwoFactorSetupPage {...common(request)} secret={secret} qrSvg={svg} error={error} />, error ? 422 : 200);
  }

  app.get('/account/2fa/setup', guard, async (request, reply) => {
    request.session.pendingTotpSecret = undefined; // every visit starts a new key
    return setupPage(request, reply);
  });

  app.post('/account/2fa/setup', { ...guard, config: strictRateLimit }, async (request, reply) => {
    const secret = request.session.pendingTotpSecret;
    if (!secret) return reply.redirect('/account/2fa/setup', 302);
    const { code } = formFields(request, 'code');
    const step = checkCode(secret, code);
    if (step === null) return setupPage(request, reply, 'That code is not right. Enter the one the app shows now.');

    await enableTwoFactor(pool, request.user!.id, secret, step);
    request.session.pendingTotpSecret = undefined;
    const codes = await replaceRecoveryCodes(pool, request.user!.id);
    return sendHtml(reply, <RecoveryCodesPage {...common(request)} codes={codes} firstTime />);
  });

  app.post('/account/2fa/recovery-codes', { ...guard, config: strictRateLimit }, async (request, reply) => {
    const { currentPassword } = formFields(request, 'currentPassword');
    const account = await accountOf(request);
    if (!account.twoFactorEnabled) return reply.redirect('/account/2fa', 302);
    if (!(await checkCurrentPassword(pool, account.id, currentPassword))) {
      return sendHtml(reply, <TwoFactorPage {...common(request)} account={account} recoveryLeft={await countRecoveryCodes(pool, account.id)}
        errors={{ recovery: 'Wrong password.' }} />, 422);
    }
    return sendHtml(reply, <RecoveryCodesPage {...common(request)} codes={await replaceRecoveryCodes(pool, account.id)} firstTime={false} />);
  });

  app.post('/account/2fa/disable', { ...guard, config: strictRateLimit }, async (request, reply) => {
    const { currentPassword } = formFields(request, 'currentPassword');
    const account = await accountOf(request);
    if (!(await checkCurrentPassword(pool, account.id, currentPassword))) {
      return sendHtml(reply, <TwoFactorPage {...common(request)} account={account} recoveryLeft={await countRecoveryCodes(pool, account.id)}
        errors={{ disable: 'Wrong password.' }} />, 422);
    }
    await disableTwoFactor(pool, account.id);
    setFlash(request, 'success', 'Two-factor login is off.');
    return reply.redirect('/account/2fa', 302);
  });

  // ---- personal data ----

  app.get('/account/personal-data', guard, async (request, reply) =>
    sendHtml(reply, <PersonalDataPage {...common(request)} errors={{}} />));

  app.get('/account/personal-data/download', guard, async (request, reply) => {
    const data = await exportPersonalData(pool, request.user!.id);
    return reply.type('application/json').header('Content-Disposition', 'attachment; filename="flytrace-data.json"')
      .send(JSON.stringify(data, null, 2));
  });

  app.post('/account/delete', { ...guard, config: strictRateLimit }, async (request, reply) => {
    const f = formFields(request, 'currentPassword', 'confirm');
    const errors: Record<string, string | undefined> = {};
    if (f.confirm !== 'yes') errors.confirm = 'Tick the box to confirm.';
    if (!(await checkCurrentPassword(pool, request.user!.id, f.currentPassword))) errors.currentPassword = 'Wrong password.';
    if (errors.confirm || errors.currentPassword) {
      return sendHtml(reply, <PersonalDataPage {...common(request)} errors={errors} />, 422);
    }
    await deleteAccount(pool, request.user!.id);
    await request.session.regenerate();
    setFlash(request, 'info', 'Your account has been deleted.');
    return reply.redirect('/', 302);
  });
}
