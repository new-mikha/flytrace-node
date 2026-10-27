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
import type { Flash } from '../views/forms.tsx';

/** Only same-site absolute paths, so the login form cannot be used as an open redirect. */
export function safeReturnUrl(value: unknown): string {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/';
}

export function setFlash(request: FastifyRequest, kind: Flash['kind'], text: string): void {
  request.session.flash = { kind, text };
}

/** The one-time message left by the previous request, removed once read. */
export function takeFlash(request: FastifyRequest): Flash | null {
  const flash = request.session.flash ?? null;
  if (flash) request.session.flash = undefined;
  return flash;
}

/** Form fields as trimmed-free raw strings (missing or non-string fields become ''). */
export function formFields<K extends string>(request: FastifyRequest, ...names: K[]): Record<K, string> {
  const body = (request.body ?? {}) as Record<string, unknown>;
  return Object.fromEntries(names.map((n) => [n, typeof body[n] === 'string' ? body[n] : ''])) as Record<K, string>;
}

/** Brute-force and abuse limits per client IP for pages that cost something (hashing, email). */
export const strictRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
export const emailRateLimit = { rateLimit: { max: 5, timeWindow: '1 minute' } };
