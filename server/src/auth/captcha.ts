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

// Google reCAPTCHA v3 in front of the forms that make the site send email: an invisible score,
// with no puzzle. Off unless RECAPTCHA_ENABLED is set, and then every check passes.
import type { FastifyRequest } from 'fastify';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const TIMEOUT_MS = 5000;

export type CaptchaAction = 'register' | 'forgot_password' | 'resend_confirmation';

interface Verdict {
  success: boolean;
  score?: number;
  action?: string;
  'error-codes'?: string[];
}

/** What the pages need: the public key, or nothing when the captcha is off. */
export const captchaSiteKey = (config: Config): string | undefined =>
  config.RECAPTCHA_ENABLED ? config.RECAPTCHA_SITE_KEY : undefined;

export const captchaRefusal = (config: Config): string =>
  `We could not tell that you are a person. Please try again, or write to ${config.MAIL_CONTACT_ADDRESS}.`;

/**
 * Is this a person, as far as Google can tell? No token means no: a script that was blocked looks
 * the same as a bot that skipped it. When Google cannot answer, or our key is wrong, people are let
 * through: a broken captcha must not lock them out, and the rate limits are still there.
 */
export async function passesCaptcha(
  request: FastifyRequest,
  config: Config,
  token: string,
  action: CaptchaAction,
): Promise<boolean> {
  if (!config.RECAPTCHA_ENABLED) return true;

  const refuse = (score?: number) => {
    audit(request, 'captcha.refused', 'Refused by the captcha', { action, score });
    return false;
  };
  if (!token) return refuse();

  let verdict: Verdict;
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: config.RECAPTCHA_SECRET_KEY!, response: token }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    verdict = (await response.json()) as Verdict;
  } catch (err) {
    request.log.warn({ err, action }, 'Could not reach the captcha service, letting the form pass');
    return true;
  }

  const codes = verdict['error-codes'] ?? [];
  if (codes.some((code) => code.includes('secret'))) {
    request.log.error({ codes }, 'The captcha key is refused by Google, letting the form pass');
    return true;
  }
  if (!verdict.success || verdict.action !== action) return refuse(verdict.score);
  if ((verdict.score ?? 0) < config.RECAPTCHA_MIN_SCORE) return refuse(verdict.score);
  return true;
}
