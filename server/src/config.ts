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

import 'dotenv/config';
import { z } from 'zod';

/** Env vars arrive as strings and an unset-but-listed one (`SMTP_HOST=`) as ''; treat '' as "not set". */
const optional = <T extends z.ZodType>(type: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), type.optional());
const flag = (fallback: boolean) =>
  z
    .preprocess(
      (v) => (v === '' || v === undefined ? undefined : v),
      z.enum(['true', 'false', '1', '0']).optional(),
    )
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** A true/false setting that may be left unset (unlike `flag`, there is no fallback to apply here). */
const optionalFlag = z
  .preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false', '1', '0']).optional())
  .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Time zone for log times and for the times shown on pages, e.g. Europe/Berlin. Unset: the host's time zone.
  LOG_TIMEZONE: optional(
    z.string().refine(isTimeZone, 'must be a time zone name such as Europe/Berlin or UTC'),
  ),
  // Comma-separated usernames to skip when importing the legacy dump.
  LEGACY_EXCLUDE_USERS: z.string().default(''),

  // Whether the session cookie is marked Secure (sent over HTTPS only). Default: yes in production, no otherwise. The session
  // library does not send a Secure cookie at all over plain HTTP, so set false only to try the site over HTTP on a home network.
  COOKIE_SECURE: optionalFlag,

  // Public address of the site, used for the links in emails (no trailing slash needed).
  PUBLIC_BASE_URL: optional(z.url()),
  // true: a user must confirm the email address before logging in.
  REQUIRE_CONFIRMED_EMAIL: flag(false),

  // Outgoing email. Without SMTP_HOST nothing is sent: the message is written to the server log instead.
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: optional(z.coerce.number().int().positive()),
  // true: TLS from the first byte (usually port 465). false: plain connection upgraded with STARTTLS (587).
  SMTP_SECURE: flag(false),
  SMTP_USER: optional(z.string()),
  SMTP_PASSWORD: optional(z.string()),
  MAIL_FROM_ADDRESS: optional(z.email()),
  MAIL_FROM_NAME: z.string().default('Flytrace'),
  // Shown in emails as the address to write to with questions.
  MAIL_CONTACT_ADDRESS: optional(z.email()),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  const config = parsed.data;
  if (config.SMTP_HOST && !config.MAIL_FROM_ADDRESS)
    throw new Error('Invalid environment:\nMAIL_FROM_ADDRESS is required when SMTP_HOST is set');
  if (config.REQUIRE_CONFIRMED_EMAIL && config.NODE_ENV === 'production' && !config.SMTP_HOST)
    throw new Error(
      'Invalid environment:\nREQUIRE_CONFIRMED_EMAIL=true needs SMTP_HOST, otherwise no one can confirm',
    );

  return config;
}

/** Site address for links in emails; falls back to the local dev server. */
export function baseUrl(config: Config): string {
  return (config.PUBLIC_BASE_URL ?? `http://127.0.0.1:${config.PORT}`).replace(/\/+$/, '');
}

export function legacyExcludedUsers(config: Config): string[] {
  return config.LEGACY_EXCLUDE_USERS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
