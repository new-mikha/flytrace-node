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

import type { FastifyRequest } from 'fastify';

/**
 * Records that somebody did something: one log line with who (the logged-in user), what (`event`, a stable
 * "area.action" name such as `password.changed`) and a readable message. Call it from every action that changes
 * something or that matters for security (login, email, passwords, groups, ...), after the action has succeeded or
 * failed. Extra `details` are kept as fields of the JSON log line.
 *
 * Never put secrets in `message` or `details`: no passwords, codes, tokens or session ids, and no typed login
 * names (people paste passwords there). Mask email addresses with `maskEmail`.
 */
export function audit(
  request: Pick<FastifyRequest, 'log' | 'user'>,
  event: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  request.log.info({ event, user: request.user?.username, userId: request.user?.id, ...details }, message);
}

/** `ann.smith@gmail.com` -> `a***@gmail.com`: enough to recognise an address, not to copy it from the logs. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}
