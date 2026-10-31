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

// User management for admins (role "Admins"): find a user, then lock / unlock, password, email, sessions, two-factor.
// Every change asks the admin to type the user's name first, and an admin cannot change their own account here.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit, maskEmail } from '../audit.ts';
import {
  canUseEmail,
  disableTwoFactor,
  emailSchema,
  endSessions,
  setPassword,
} from '../auth/accounts.ts';
import { requireRole } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import type { MailService } from '../mail/service.ts';
import {
  getManagedUser,
  listUsers,
  type ManagedUser,
  parseSort,
  setEmailConfirmed,
  setLocked,
  USERS_PAGE_SIZE,
} from '../repo/adminUsers.ts';
import { AdminUsersPage } from '../views/AdminPages.tsx';
import {
  type AdminErrors,
  AdminUserIndexPage,
  AdminUserSectionPage,
  isSection,
  type SectionSlug,
} from '../views/AdminUserPages.tsx';
import { sendHtml } from '../views/render.tsx';
import { passwordErrors } from './identity.tsx';
import { emailRateLimit, formFields, setFlash, strictRateLimit, takeFlash } from './util.ts';

type Fields = Record<string, string>;

export async function adminRoutes(
  app: FastifyInstance,
  pool: Pool,
  mail: MailService,
): Promise<void> {
  const guard = { preHandler: requireRole('Admins') };
  const common = (request: FastifyRequest) => ({
    user: request.user!,
    path: request.url.split('?')[0]!,
    flash: takeFlash(request),
  });
  const recipientOf = (
    t: ManagedUser,
  ) => (t.email ? { id: t.id, username: t.username, email: t.email } : null);
  const about = (t: ManagedUser) => ({ target: t.username, targetId: t.id });

  app.get<{ Querystring: { q?: string; page?: string; sort?: string; dir?: string; }; }>(
    '/admin',
    guard,
    async (request, reply) => {
      const q = (request.query.q ?? '').trim().slice(0, 100);
      let pageNo = Math.max(1, Math.floor(Number(request.query.page)) || 1);
      const sort = parseSort(request.query.sort, request.query.dir);
      let { rows, total } = await listUsers(pool, q, pageNo, sort);
      const lastPage = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
      if (pageNo > lastPage) { // a typed page number past the end shows the last page
        pageNo = lastPage;
        ({ rows, total } = await listUsers(pool, q, pageNo, sort));
      }
      return sendHtml(
        reply,
        <AdminUsersPage
          {...common(request)}
          q={q}
          users={rows}
          total={total}
          pageNo={pageNo}
          pageSize={USERS_PAGE_SIZE}
          sort={sort}
        />,
      );
    },
  );

  app.get<{ Params: { id: string; }; }>('/admin/users/:id', guard, async (request, reply) => {
    const target = await getManagedUser(pool, request.params.id);
    if (!target)
      return reply.redirect('/admin', 302);
    return sendHtml(reply, <AdminUserIndexPage {...common(request)} target={target} />);
  });

  app.get<{ Params: { id: string; section: string; }; }>(
    '/admin/users/:id/:section',
    guard,
    async (request, reply) => {
      const target = await getManagedUser(pool, request.params.id);
      if (!target)
        return reply.redirect('/admin', 302);
      // an unknown section, or any section of the admin's own account (which has none), goes back to the user
      if (!isSection(request.params.section) || target.id === request.user!.id)
        return reply.redirect(`/admin/users/${target.id}`, 302);
      return sendHtml(
        reply,
        <AdminUserSectionPage
          {...common(request)}
          target={target}
          section={request.params.section}
          errors={{}}
          values={{}}
        />,
      );
    },
  );

  /**
   * One POST route per change. `validate` returns field errors; `execute` makes the change, audits it and returns the
   * message for the admin. Nothing runs unless the typed name matches (case-insensitively, like user names are unique).
   */
  function change(slug: string, fieldNames: string[], rate: object, steps: {
    validate?: (f: Fields, target: ManagedUser) => Promise<AdminErrors> | AdminErrors;
    execute: (f: Fields, target: ManagedUser, request: FastifyRequest) => Promise<string>;
  }): void {
    app.post<{ Params: { id: string; }; }>(
      `/admin/users/:id/${slug}`,
      { ...guard, config: rate },
      async (request, reply) => {
        const target = await getManagedUser(pool, request.params.id);
        if (!target)
          return reply.redirect('/admin', 302);
        const section: SectionSlug = slug === 'unlock' ? 'lock' : (slug as SectionSlug); // the lock page posts to /lock or /unlock
        const back = `/admin/users/${target.id}/${section}`;
        if (target.id === request.user!.id) {
          setFlash(request, 'danger', 'This is your own account. Use Settings to change it.');
          return reply.redirect(`/admin/users/${target.id}`, 302);
        }
        const f: Fields = formFields(request, 'confirmName', ...fieldNames);
        const errors: AdminErrors = { form: slug, ...(await steps.validate?.(f, target)) };
        if ((f.confirmName ?? '').trim().toLowerCase() !== target.username.toLowerCase()) {
          errors.confirmName =
            `Type ${target.username} exactly, to show that this is the right user.`;
          audit(request, 'admin.confirm_failed', `Wrong user name typed to confirm "${slug}"`, {
            ...about(target),
            action: slug,
          });
        }
        if (Object.entries(errors).some(([key, message]) => key !== 'form' && message))
          return sendHtml(
            reply,
            <AdminUserSectionPage
              {...common(request)}
              target={target}
              section={section}
              errors={errors}
              values={f}
            />,
            422,
          );

        setFlash(request, 'success', await steps.execute(f, target, request));
        return reply.redirect(back, 302);
      },
    );
  }

  change('lock', [], strictRateLimit, {
    async execute(_f, t, request) {
      await setLocked(pool, t.id, true);
      audit(
        request,
        'admin.user_locked',
        `Locked ${t.username}; their sessions were ended`,
        about(t),
      );
      return `${t.username} is locked and logged out.`;
    },
  });

  change('unlock', [], strictRateLimit, {
    async execute(_f, t, request) {
      await setLocked(pool, t.id, false);
      audit(request, 'admin.user_unlocked', `Unlocked ${t.username}`, about(t));
      return `${t.username} can log in again.`;
    },
  });

  change('reset-link', [], emailRateLimit, {
    validate: (
      _f,
      t,
    ) => (t.email ? {} : { general: 'This user has no email address, so no link can be sent.' }),
    async execute(_f, t, request) {
      const to = recipientOf(t)!;
      mail.queue(() => mail.sendResetPassword(to));
      audit(request, 'admin.password_reset_sent', `Sent a password reset link to ${t.username}`, {
        ...about(t),
        to: maskEmail(to.email),
      });
      return `A password reset link was sent to ${to.email}. It works for one hour.`;
    },
  });

  change('password', ['password', 'confirmPassword'], strictRateLimit, {
    validate(f, t) {
      const errors: AdminErrors = passwordErrors(f.password!, f.confirmPassword!);
      const same = [t.username, t.email ?? ''].some((x) =>
        x && x.toLowerCase() === f.password!.toLowerCase()
      );
      if (!errors.password && same)
        errors.password = 'The password must not be the same as the username or email.';
      return errors;
    },
    async execute(f, t, request) {
      await setPassword(pool, t.id, f.password!); // all their sessions end
      audit(
        request,
        'admin.password_set',
        `Set a new password for ${t.username}; their sessions were ended`,
        about(t),
      );
      const to = recipientOf(t);
      if (to)
        mail.queue(() => mail.sendPasswordChanged(to));
      return `The password of ${t.username} is changed and they are logged out everywhere.${
        to ? ' They were told by email.' : ''
      }`;
    },
  });

  change('email', ['email'], emailRateLimit, {
    async validate(f, t) {
      const email = f.email!.trim();
      const parsed = emailSchema.safeParse(email);
      if (!parsed.success)
        return { email: parsed.error.issues[0]?.message };
      if (t.email?.toLowerCase() === email.toLowerCase())
        return { email: 'This is already their email address.' };
      if (!(await canUseEmail(pool, email, t.id)))
        return { email: 'This email address is already registered.' };
      return {};
    },
    async execute(f, t, request) {
      const email = f.email!.trim();
      mail.queue(() => mail.sendChangeEmail({ id: t.id, username: t.username, email }, email));
      audit(
        request,
        'admin.email_change_requested',
        `Asked ${t.username} to confirm a new email address ${maskEmail(email)}`,
        about(t),
      );
      return `A confirmation link was sent to ${email}. The address of ${t.username} changes when the link is opened.`;
    },
  });

  change('email-status', ['to'], strictRateLimit, {
    validate: (
      f,
      t,
    ) => (!t.email
      ? { general: 'This user has no email address.' }
      : !['yes', 'no'].includes(f.to!)
      ? { general: 'Unknown choice.' }
      : {}),
    async execute(f, t, request) {
      const confirmed = f.to === 'yes';
      await setEmailConfirmed(pool, t.id, confirmed);
      audit(
        request,
        'admin.email_confirmed_set',
        `Marked the email of ${t.username} as ${confirmed ? 'confirmed' : 'not confirmed'}`,
        about(t),
      );
      return `The email address of ${t.username} is now marked as ${
        confirmed ? 'confirmed' : 'not confirmed'
      }.`;
    },
  });

  change('end-sessions', [], strictRateLimit, {
    async execute(_f, t, request) {
      await endSessions(pool, t.id);
      audit(request, 'admin.sessions_ended', `Ended all sessions of ${t.username}`, about(t));
      return `${t.username} is logged out everywhere.`;
    },
  });

  change('disable-2fa', [], strictRateLimit, {
    validate: (
      _f,
      t,
    ) => (t.twoFactorEnabled ? {} : { general: 'Two-factor login is not on for this user.' }),
    async execute(_f, t, request) {
      await disableTwoFactor(pool, t.id);
      audit(
        request,
        'admin.2fa_disabled',
        `Turned off two-factor login of ${t.username}`,
        about(t),
      );
      return `Two-factor login of ${t.username} is off. They can set it up again in their settings.`;
    },
  });
}
