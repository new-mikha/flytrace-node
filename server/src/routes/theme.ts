import type { FastifyInstance } from 'fastify';
import { safeReturnUrl } from './util.ts';

export const THEME_COOKIE = 'ft-theme';
const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** The day theme is the default whatever the browser or system prefers (like the original site); only a cookie says "dark". */
export function themeOf(cookies: Record<string, string | undefined> | undefined): 'light' | 'dark' {
  return cookies?.[THEME_COOKIE] === 'dark' ? 'dark' : 'light';
}

/**
 * Switches between the day and the night theme and goes back to the page the person was on. public/js/app.js does the
 * same in place without a reload; this is for browsers without JavaScript. `?set=light|dark` picks one explicitly.
 */
export async function themeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { set?: string; returnUrl?: string } }>('/theme', async (request, reply) => {
    const { set } = request.query;
    const next = set === 'dark' || set === 'light' ? set : themeOf(request.cookies) === 'dark' ? 'light' : 'dark';
    reply.setCookie(THEME_COOKIE, next, { path: '/', maxAge: ONE_YEAR_S, sameSite: 'lax' }); // readable by app.js on purpose
    return reply.redirect(safeReturnUrl(request.query.returnUrl), 302);
  });
}
