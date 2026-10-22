import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import connectPgSimple from 'connect-pg-simple';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { Pool } from '../db.ts';
import { loadUser, type CurrentUser } from './service.ts';

declare module 'fastify' {
  interface FastifyRequest { user: CurrentUser | null }
}
declare module '@fastify/session' {
  interface FastifySessionObject {
    userId?: string;
    /** Password was right but the authenticator code is still to come (login step 2). */
    pendingLogin?: { userId: string; returnUrl: string; attempts: number; expires: number };
    /** Authenticator secret being set up, not saved to the user until a code from the app is confirmed. */
    pendingTotpSecret?: string;
    /** One-time message shown on the next page. */
    flash?: { kind: 'success' | 'info' | 'danger'; text: string };
  }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // same as the old site's forms-auth timeout

export async function registerSession(app: FastifyInstance, config: Config, pool: Pool): Promise<void> {
  // connect-pg-simple is written for express-session; @fastify/session is API compatible with it.
  const PgStore = connectPgSimple(fastifySession as unknown as Parameters<typeof connectPgSimple>[0]);

  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: config.SESSION_SECRET,
    cookieName: 'flytrace.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: SEVEN_DAYS_MS,
    },
    rolling: true,
    saveUninitialized: false,
    store: new PgStore({ pool, tableName: 'sessions' }) as unknown as NonNullable<Parameters<typeof fastifySession>[1]>['store'],
  });

  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request) => {
    const userId = request.session.userId;
    request.user = userId ? await loadUser(pool, userId) : null;
    if (userId && !request.user) await request.session.destroy(); // deleted / locked out since login
  });
}
