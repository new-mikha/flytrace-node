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

import { esc } from '../routes/html.ts';
import type { MailMessage } from './mailer.ts';

export interface MailContext {
  siteName: string;
  siteUrl: string;
  contactAddress?: string;
}

type Built = Omit<MailMessage, 'to'>;

/** HTML and plain-text bodies of one message. `action` is the call-to-action link, if any. */
function build(
  ctx: MailContext,
  subject: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): Built {
  const contact = ctx.contactAddress
    ? `If you have any questions, write to ${ctx.contactAddress}.`
    : '';
  const html = `<div style="margin:0;padding:0;font-family:Arial,sans-serif;color:#1f2937">
${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}
${
  action
    ? `<p style="margin:24px 0"><a href="${esc(
        action.url,
      )}" style="background:#0d6efd;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(
        action.label,
      )}</a></p>
<p style="font-size:12px;color:#6b7280">If the button does not work, copy this address into your browser:<br>${esc(
        action.url,
      )}</p>`
    : ''
}
${contact ? `<p>${esc(contact)}</p>` : ''}
<p>Thank you!</p>
<div>--</div>
<div><a href="${esc(ctx.siteUrl)}">${esc(ctx.siteUrl)}</a></div>
</div>`;
  const text = [
    ...paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    ...(contact ? [contact] : []),
    'Thank you!',
    '--',
    ctx.siteUrl,
  ].join('\n\n');
  return { subject, html, text };
}

export function confirmEmailMessage(ctx: MailContext, username: string, url: string): Built {
  return build(
    ctx,
    `Confirm your email for ${ctx.siteName}`,
    [
      `Hello ${username}, and welcome to ${ctx.siteName}!`,
      'Please confirm your email address to activate your account. The link can be used only once and expires in 3 days.',
    ],
    { label: 'Confirm email', url },
  );
}

export function resetPasswordMessage(ctx: MailContext, username: string, url: string): Built {
  return build(
    ctx,
    `Reset your ${ctx.siteName} password`,
    [
      `Hello ${username},`,
      `We received a request to reset your ${ctx.siteName} password. The link can be used only once and expires in 1 hour.`,
      'If you did not ask for this, you can ignore this email: your password stays as it is.',
    ],
    { label: 'Reset your password', url },
  );
}

export function changeEmailMessage(ctx: MailContext, username: string, url: string): Built {
  return build(
    ctx,
    `Confirm your new email for ${ctx.siteName}`,
    [
      `Hello ${username},`,
      `Please confirm that this is your new email address for ${ctx.siteName}. The link can be used only once and expires in 3 days.`,
    ],
    { label: 'Confirm new email', url },
  );
}

export function testMessage(ctx: MailContext, username: string): Built {
  return build(ctx, `Test email from ${ctx.siteName}`, [
    `Hello ${username},`,
    `This is a test email that you just sent to yourself from your ${ctx.siteName} account. If you can read it, emails from ${ctx.siteName} reach you.`,
  ]);
}

export function passwordChangedMessage(ctx: MailContext, username: string): Built {
  return build(ctx, `Your ${ctx.siteName} password was changed`, [
    `Hello ${username},`,
    `The password of your ${ctx.siteName} account has just been changed. If it was not you, reset your password right away.`,
  ]);
}
