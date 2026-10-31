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

// Pages for people who are not (or not yet) logged in: log in (with the second step), register,
// confirm email, forgot / reset password. The logged-in "My account" pages are in account.tsx.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit, maskEmail } from '../audit.ts';
import {
  changeEmail,
  confirmEmail,
  emailSchema,
  emailTaken,
  findByLogin,
  getAccount,
  isUsernameTaken,
  newPasswordSchema,
  registerUser,
  setPassword,
  usernameSchema,
} from '../auth/accounts.ts';
import { checkPassword, completeLogin } from '../auth/service.ts';
import { consumeToken, peekToken } from '../auth/tokens.ts';
import { useRecoveryCode, verifyUserCode } from '../auth/totp.ts';
import type { Config } from '../config.ts';
import type { Pool } from '../db.ts';
import type { MailService } from '../mail/service.ts';
import {
  CheckEmailPage,
  ForgotPasswordPage,
  LinkPage,
  LoginPage,
  MessagePage,
  RecoveryLoginPage,
  RegisterPage,
  ResendConfirmationPage,
  ResetPasswordPage,
  TwoFactorLoginPage,
} from '../views/IdentityPages.tsx';
import { sendHtml } from '../views/render.tsx';
import {
  emailRateLimit,
  formFields,
  safeReturnUrl,
  setFlash,
  strictRateLimit,
  takeFlash,
} from './util.ts';

const PENDING_LOGIN_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

type Reply = Parameters<typeof sendHtml>[0];

function firstIssue(
  schema: {
    safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } };
  },
  value: string,
): string | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? undefined : parsed.error?.issues[0]?.message;
}

/** Shared by registration, reset and change-password: the new password and its confirmation. */
export function passwordErrors(
  password: string,
  confirm: string,
  forbidden: string[] = [],
): { password?: string; confirmPassword?: string } {
  const errors: { password?: string; confirmPassword?: string } = {};
  errors.password = firstIssue(newPasswordSchema, password);
  if (!errors.password && forbidden.some((f) => f && f.toLowerCase() === password.toLowerCase()))
    errors.password = 'The password must not be the same as your username or email.';
  if (!errors.password && password !== confirm)
    errors.confirmPassword = 'The two passwords do not match.';
  return errors;
}

export async function identityRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  mail: MailService,
): Promise<void> {
  const common = (request: FastifyRequest) => ({
    user: request.user,
    path: request.url.split('?')[0]!,
    flash: takeFlash(request),
  });

  /** Logs the user in: a fresh session id (against session fixation), then the stored user id. */
  async function startSession(request: FastifyRequest, userId: string): Promise<void> {
    await request.session.regenerate();
    request.session.userId = userId;
  }

  // ---- log in ----

  app.get<{ Querystring: { returnUrl?: string; error?: string } }>(
    '/login',
    async (request, reply) => {
      const returnUrl = safeReturnUrl(request.query.returnUrl);
      if (request.user) return reply.redirect(returnUrl, 302);
      const e = request.query.error;
      const error =
        e === 'unconfirmed' || e === 'locked' || e === 'expired' ? e : e ? 'invalid' : undefined;
      return sendHtml(
        reply,
        <LoginPage {...common(request)} returnUrl={returnUrl} error={error} />,
      );
    },
  );

  app.post('/login', { config: strictRateLimit }, async (request, reply) => {
    const fields = formFields(request, 'username', 'password', 'returnUrl');
    const returnUrl = safeReturnUrl(fields.returnUrl);
    const fail = (error: string) =>
      reply.redirect(`/login?error=${error}&returnUrl=${encodeURIComponent(returnUrl)}`, 302);
    const login = fields.username.trim();
    if (!login || !fields.password || login.length > 256 || fields.password.length > 1024)
      return fail('1');

    const result = await checkPassword(
      pool,
      login,
      fields.password,
      config.REQUIRE_CONFIRMED_EMAIL,
    );
    switch (result.kind) {
      case 'ok':
        await startSession(request, result.user.id);
        audit(request, 'login.success', 'Logged in', {
          user: result.user.username,
          userId: result.user.id,
        });
        return reply.redirect(returnUrl, 302);
      case 'two-factor':
        audit(
          request,
          'login.password_ok',
          'Password accepted, waiting for the authenticator code',
          { userId: result.userId },
        );
        await request.session.regenerate();
        request.session.pendingLogin = {
          userId: result.userId,
          returnUrl,
          attempts: 0,
          expires: Date.now() + PENDING_LOGIN_MS,
        };
        return reply.redirect('/login/2fa', 302);
      case 'email-unconfirmed':
        audit(request, 'login.refused', 'Login refused: email address not confirmed yet', {
          userId: result.userId,
        });
        return fail('unconfirmed');
      default:
        // no login name: people paste passwords there:
        audit(request, 'login.failed', 'Failed login attempt', { ip: request.ip });
        return fail('1');
    }
  });

  /** Second step: the pending login, or null (and the caller sends the user back to the start). */
  function pendingLogin(request: FastifyRequest) {
    const pending = request.session.pendingLogin;
    return pending && pending.expires > Date.now() ? pending : null;
  }

  async function secondStep(
    request: FastifyRequest,
    reply: Reply,
    kind: string,
    verify: (userId: string, code: string) => Promise<boolean>,
    retryPage: () => ReturnType<typeof sendHtml>,
  ) {
    const pending = pendingLogin(request);
    if (!pending) return reply.redirect('/login?error=expired', 302);
    const { code } = formFields(request, 'code');
    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      audit(request, 'login.locked', 'Too many wrong codes, login attempt cancelled', {
        userId: pending.userId,
        ip: request.ip,
      });
      request.session.pendingLogin = undefined;
      return reply.redirect('/login?error=locked', 302);
    }
    request.session.pendingLogin = { ...pending, attempts: pending.attempts + 1 };
    if (!code || code.length > 40 || !(await verify(pending.userId, code))) {
      audit(request, 'login.code_failed', `Wrong ${kind}`, {
        userId: pending.userId,
        ip: request.ip,
      });
      return retryPage();
    }

    const result = await completeLogin(pool, pending.userId);
    if (result.kind !== 'ok') return reply.redirect('/login?error=1', 302);
    await startSession(request, result.user.id);
    audit(request, 'login.success', `Logged in with ${kind}`, {
      user: result.user.username,
      userId: result.user.id,
    });
    return reply.redirect(pending.returnUrl, 302);
  }

  app.get('/login/2fa', async (request, reply) => {
    if (!pendingLogin(request)) return reply.redirect('/login?error=expired', 302);
    return sendHtml(reply, <TwoFactorLoginPage {...common(request)} />);
  });
  app.post('/login/2fa', { config: strictRateLimit }, async (request, reply) =>
    secondStep(
      request,
      reply,
      'authenticator code',
      (id, code) => verifyUserCode(pool, id, code),
      () => sendHtml(reply, <TwoFactorLoginPage {...common(request)} error />, 401),
    ),
  );

  app.get('/login/recovery', async (request, reply) => {
    if (!pendingLogin(request)) return reply.redirect('/login?error=expired', 302);
    return sendHtml(reply, <RecoveryLoginPage {...common(request)} />);
  });
  app.post('/login/recovery', { config: strictRateLimit }, async (request, reply) =>
    secondStep(
      request,
      reply,
      'recovery code',
      (id, code) => useRecoveryCode(pool, id, code),
      () => sendHtml(reply, <RecoveryLoginPage {...common(request)} error />, 401),
    ),
  );

  // ---- register ----

  app.get('/register', async (request, reply) => {
    if (request.user) return reply.redirect('/account', 302);
    return sendHtml(reply, <RegisterPage {...common(request)} values={{}} errors={{}} />);
  });

  // Answers the "not taken yet" hints on the register and change-email pages while the person
  // types. Reveals whether a username or email is registered, which registering itself reveals as
  // well; hence the rate limit.
  app.get<{ Querystring: { username?: string; email?: string } }>(
    '/register/check',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { username, email } = request.query;
      reply.header('Cache-Control', 'no-store');
      if (typeof username === 'string' && usernameSchema.safeParse(username.trim()).success)
        return { taken: await isUsernameTaken(pool, username.trim()) };
      if (typeof email === 'string' && emailSchema.safeParse(email.trim()).success)
        // a logged-in person changing their address is not "taken" by their own current one
        return { taken: await emailTaken(pool, email.trim(), request.user?.id) };

      // not a valid value: the format hints say so, there is nothing to look up:
      return { taken: false };
    },
  );

  app.post('/register', { config: emailRateLimit }, async (request, reply) => {
    const f = formFields(request, 'username', 'email', 'password', 'confirmPassword');
    const username = f.username.trim();
    const email = f.email.trim();
    const errors: Record<string, string | undefined> = {
      username: firstIssue(usernameSchema, username),
      email: firstIssue(emailSchema, email),
      ...passwordErrors(f.password, f.confirmPassword, [username, email]),
    };
    const show = (status: number) =>
      sendHtml(
        reply,
        <RegisterPage {...common(request)} values={{ username, email }} errors={errors} />,
        status,
      );
    if (Object.values(errors).some(Boolean)) return show(422);

    const result = await registerUser(pool, { username, email, password: f.password });
    if (!result.ok) {
      errors[result.field] = result.message;
      return show(409);
    }
    audit(request, 'register.created', `New account registered (${maskEmail(email)})`, {
      user: username,
      userId: result.userId,
    });
    mail.queue(() => mail.sendConfirmEmail({ id: result.userId, username, email }));

    if (config.REQUIRE_CONFIRMED_EMAIL)
      return sendHtml(
        reply,
        <CheckEmailPage {...common(request)} email={email} emailSent={mail.canDeliver} />,
      );

    await startSession(request, result.userId);
    setFlash(request, 'success', `Welcome, ${username}! We sent a confirmation link to ${email}.`);
    return reply.redirect('/account', 302);
  });

  // ---- confirm email ----

  app.get<{ Querystring: { token?: string } }>('/confirm-email', async (request, reply) => {
    const token = request.query.token ?? '';
    const valid = token.length > 0 && (await peekToken(pool, token, 'confirm_email')) !== null;
    return sendHtml(
      reply,
      <LinkPage
        {...common(request)}
        title="Confirm your email"
        icon="fa-regular fa-envelope"
        action="/confirm-email"
        token={token}
        valid={valid}
        button="Confirm my email"
        intro="Press the button to confirm your email address."
      />,
      valid ? 200 : 400,
    );
  });

  app.post('/confirm-email', { config: strictRateLimit }, async (request, reply) => {
    const { token } = formFields(request, 'token');
    const info = await consumeToken(pool, token, 'confirm_email');
    if (!info) return reply.redirect(`/confirm-email?token=${encodeURIComponent(token)}`, 302);
    await confirmEmail(pool, info.userId);
    audit(request, 'email.confirmed', 'Email address confirmed', { userId: info.userId });
    setFlash(request, 'success', 'Thank you! Your email is confirmed.');
    return reply.redirect(request.user ? '/account' : '/login', 302);
  });

  app.get<{ Querystring: { token?: string } }>('/confirm-email-change', async (request, reply) => {
    const token = request.query.token ?? '';
    const info = token ? await peekToken(pool, token, 'change_email') : null;
    return sendHtml(
      reply,
      <LinkPage
        {...common(request)}
        title="Confirm your new email"
        icon="fa-regular fa-envelope"
        action="/confirm-email-change"
        token={token}
        valid={info !== null}
        button="Use this email address"
        intro={
          <>
            Press the button to make <strong>{info?.data}</strong> the email address of your
            account.
          </>
        }
      />,
      info ? 200 : 400,
    );
  });

  app.post('/confirm-email-change', { config: strictRateLimit }, async (request, reply) => {
    const { token } = formFields(request, 'token');
    const info = await consumeToken(pool, token, 'change_email');
    if (!info?.data)
      return reply.redirect(`/confirm-email-change?token=${encodeURIComponent(token)}`, 302);
    if (!(await changeEmail(pool, info.userId, info.data)))
      return sendHtml(
        reply,
        <MessagePage
          {...common(request)}
          title="Email already in use"
          icon="fa-regular fa-envelope"
        >
          <p class="mb-0">
            Somebody else has registered {info.data} in the meantime. Please choose another address.
          </p>
        </MessagePage>,
        409,
      );

    audit(request, 'email.changed', `Email address changed to ${maskEmail(info.data)}`, {
      userId: info.userId,
    });
    setFlash(request, 'success', 'Your email address has been changed.');
    return reply.redirect(request.user ? '/account' : '/login', 302);
  });

  app.get('/resend-confirmation', async (request, reply) =>
    sendHtml(reply, <ResendConfirmationPage {...common(request)} />),
  );

  app.post('/resend-confirmation', { config: emailRateLimit }, async (request, reply) => {
    const { login } = formFields(request, 'login');
    if (!login.trim())
      return sendHtml(
        reply,
        <ResendConfirmationPage {...common(request)} error="Enter your username or email." />,
        422,
      );

    const found = login.length <= 256 ? await findByLogin(pool, login.trim()) : null;
    if (found?.email && !found.emailConfirmed) {
      const recipient = { id: found.id, username: found.username, email: found.email };
      mail.queue(() => mail.sendConfirmEmail(recipient));
    }
    // Same answer whether or not the account exists, so this page cannot be used to look up who is
    // registered.
    return sendHtml(
      reply,
      <MessagePage {...common(request)} title="Check your email" icon="fa-regular fa-envelope">
        <p class="mb-0">
          If that account exists and still needs confirming, we have sent the link again.
        </p>
      </MessagePage>,
    );
  });

  // ---- forgot / reset password ----

  app.get('/forgot-password', async (request, reply) =>
    sendHtml(reply, <ForgotPasswordPage {...common(request)} />),
  );

  app.post('/forgot-password', { config: emailRateLimit }, async (request, reply) => {
    const { login } = formFields(request, 'login');
    if (!login.trim())
      return sendHtml(
        reply,
        <ForgotPasswordPage {...common(request)} error="Enter your username or email." />,
        422,
      );

    const found = login.length <= 256 ? await findByLogin(pool, login.trim()) : null;
    if (found?.email) {
      const recipient = { id: found.id, username: found.username, email: found.email };
      audit(request, 'password.reset_requested', 'Password reset requested', {
        user: found.username,
        userId: found.id,
      });
      mail.queue(() => mail.sendResetPassword(recipient));
    }
    return sendHtml(
      reply,
      <MessagePage {...common(request)} title="Check your email" icon="fa-regular fa-envelope">
        <p>
          If an account with that name or email exists and has an email address, we have sent a link
          to choose a new password. It works for one hour.
        </p>
        <p class="mb-0">
          <a href="/login">Back to log in</a>
        </p>
      </MessagePage>,
    );
  });

  app.get<{ Querystring: { token?: string } }>('/reset-password', async (request, reply) => {
    const token = request.query.token ?? '';
    const info = token.length > 0 ? await peekToken(pool, token, 'reset_password') : null;
    const account = info ? await getAccount(pool, info.userId) : null;
    return sendHtml(
      reply,
      <ResetPasswordPage
        {...common(request)}
        token={token}
        valid={info !== null}
        errors={{}}
        forbidden={[account?.username ?? '', account?.email ?? ''].filter(Boolean)}
      />,
      info ? 200 : 400,
    );
  });

  app.post('/reset-password', { config: strictRateLimit }, async (request, reply) => {
    const f = formFields(request, 'token', 'password', 'confirmPassword');
    const info = await peekToken(pool, f.token, 'reset_password');
    if (!info)
      return sendHtml(
        reply,
        <ResetPasswordPage {...common(request)} token={f.token} valid={false} errors={{}} />,
        400,
      );

    const account = await getAccount(pool, info.userId);
    const errors = passwordErrors(f.password, f.confirmPassword, [
      account?.username ?? '',
      account?.email ?? '',
    ]);
    if (errors.password || errors.confirmPassword)
      return sendHtml(
        reply,
        <ResetPasswordPage
          {...common(request)}
          token={f.token}
          valid
          errors={errors}
          forbidden={[account?.username ?? '', account?.email ?? ''].filter(Boolean)}
        />,
        422,
      );

    if (!(await consumeToken(pool, f.token, 'reset_password')))
      // lost a race with another submit of the same link
      return sendHtml(
        reply,
        <ResetPasswordPage {...common(request)} token={f.token} valid={false} errors={{}} />,
        400,
      );

    await setPassword(pool, info.userId, f.password); // also logs out every session of this user
    await confirmEmail(pool, info.userId); // the link reached their mailbox, which proves it
    audit(request, 'password.reset', 'Password reset with an emailed link; other sessions ended', {
      user: account?.username,
      userId: info.userId,
    });
    if (account?.email) {
      const recipient = { id: account.id, username: account.username, email: account.email };
      mail.queue(() => mail.sendPasswordChanged(recipient));
    }
    // the visitor who used the link is not logged in as a side effect:
    await request.session.regenerate();
    setFlash(request, 'success', 'Your password has been changed. You can log in now.');
    return reply.redirect('/login', 302);
  });
}
