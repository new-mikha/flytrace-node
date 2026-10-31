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

import fastifyFormbody from '@fastify/formbody';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, LogController } from 'fastify';
import { join } from 'node:path';
import { registerSession } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db.ts';
import { createMailer, type Mailer } from './mail/mailer.ts';
import { MailService } from './mail/service.ts';
import { packageDir, projectRoot } from './paths.ts';
import { accountRoutes } from './routes/account.tsx';
import { adminRoutes } from './routes/admin.tsx';
import { eventRoutes } from './routes/events.tsx';
import { groupRoutes } from './routes/groups.tsx';
import { homeRoutes } from './routes/home.tsx';
import { identityRoutes } from './routes/identity.tsx';
import { pageRoutes } from './routes/pages.ts';
import { settingsRoutes } from './routes/settings.tsx';
import { themeOf, themeRoutes } from './routes/theme.ts';

/** Production log times: ISO 8601 in the process's time zone with its offset (pino's default is epoch milliseconds). */
function localIsoTime(): string {
  const d = new Date();
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${
    p(d.getMilliseconds(), 3)
  }`;
  return `,"time":"${date}T${time}${sign}${p(Math.floor(Math.abs(offset) / 60))}:${
    p(Math.abs(offset) % 60)
  }"`;
}

/**
 * `mailer` can be replaced (tests capture the messages); by default it comes from the SMTP_* settings.
 * `logStream` makes the app write its JSON log lines there (tests read them).
 */
export async function buildApp(
  config: Config,
  pool: Pool,
  mailer?: Mailer,
  logStream?: NodeJS.WritableStream,
): Promise<FastifyInstance> {
  const app = Fastify({
    // JSON lines in production (for log tools), readable lines in development, nothing in tests.
    logger: logStream
      ? { level: 'info', stream: logStream }
      : config.NODE_ENV === 'test'
      ? false
      : config.NODE_ENV === 'production'
      ? { level: 'info', timestamp: localIsoTime }
      : {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:HH:MM:ss', // SYS: = the process's time zone (LOG_TIMEZONE, else the host's), not UTC
            // messages are written to be read on their own; the fields stay in the JSON logs of production
            ignore: 'pid,hostname,reqId,event,user,userId,to,subject,action,ip',
            messageFormat: '{msg}{if user} [{user}]{end}',
          },
        },
      },
    // Fastify's own two lines per request are replaced by the one line per page request below.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.NODE_ENV === 'production', // behind nginx in production
  });

  // Every HTML page gets the visitor's theme (Bootstrap's `data-bs-theme`) on <html>, so the right colours are there from
  // the first paint. Done here, once, instead of in every page.
  app.addHook('onSend', async (request, reply, payload) => {
    if (typeof payload === 'string' &&
      String(reply.getHeader('content-type') ?? '').startsWith('text/html'))
      return payload.replace(
        '<html lang="en">',
        `<html lang="en" data-bs-theme="${themeOf(request.cookies)}">`,
      );

    return payload;
  });

  // One line per page request: "GET /register 200 14ms". Static files (CSS, JS, fonts, images) are skipped, and the
  // query string is left out because it can hold one-time tokens (emailed links) and typed usernames or emails.
  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (path.startsWith('/assets/') || path.startsWith('/vendor/'))
      return;
    request.log.info(
      { user: request.user?.username },
      `${request.method} ${path} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`,
    );
  });

  // Static files first: routes registered before the session plugin do not run its per-request user lookup.
  await app.register(fastifyStatic, { root: join(projectRoot(), 'public'), prefix: '/assets/' });
  await app.register(fastifyStatic, {
    root: join(packageDir('bootstrap'), 'dist'),
    prefix: '/vendor/bootstrap/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: packageDir('@fortawesome/fontawesome-free'),
    prefix: '/vendor/fontawesome/',
    decorateReply: false,
  });

  await app.register(fastifyFormbody);
  await app.register(fastifyRateLimit, { global: false });
  await registerSession(app, config, pool);
  const mail = new MailService(config, pool, mailer ?? createMailer(config, app.log), app.log);
  app.decorate('mail', mail);
  await identityRoutes(app, pool, config, mail);
  await accountRoutes(app, pool, config, mail);
  await adminRoutes(app, pool, mail);
  await settingsRoutes(app, pool);
  await themeRoutes(app);
  await groupRoutes(app, pool);
  await eventRoutes(app, pool);
  await homeRoutes(app, pool);
  await pageRoutes(app);

  app.addHook('onClose', async () => {
    await mail.flush();
    await pool.end();
  });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    mail: MailService;
  }
}
