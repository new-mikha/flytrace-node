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

import type { FastifyInstance } from 'fastify';
import { safeReturnUrl } from './util.ts';

export const THEME_COOKIE = 'ft-theme';
const ONE_YEAR_S = 365 * 24 * 60 * 60;

/**
 * The day theme is the default whatever the browser or system prefers (like the original site);
 * only a cookie says "dark".
 */
export function themeOf(cookies: Record<string, string | undefined> | undefined): 'light' | 'dark' {
  return cookies?.[THEME_COOKIE] === 'dark' ? 'dark' : 'light';
}

/**
 * Switches between the day and the night theme and goes back to the page the person was on.
 * public/js/app.js does the same in place without a reload; this is for browsers without
 * JavaScript. `?set=light|dark` picks one explicitly.
 */
export async function themeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { set?: string; returnUrl?: string } }>(
    '/theme',
    async (request, reply) => {
      const { set } = request.query;
      const next =
        set === 'dark' || set === 'light'
          ? set
          : themeOf(request.cookies) === 'dark'
            ? 'light'
            : 'dark';
      // readable by app.js on purpose:
      reply.setCookie(THEME_COOKIE, next, { path: '/', maxAge: ONE_YEAR_S, sameSite: 'lax' });
      return reply.redirect(safeReturnUrl(request.query.returnUrl), 302);
    },
  );
}
