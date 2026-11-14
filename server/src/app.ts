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
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import { join, resolve } from 'node:path';
import { pino, type DestinationStream } from 'pino';
import pretty from 'pino-pretty';
import { registerSession } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db.ts';
import { fileLogger, localIsoTime, PRETTY_OPTIONS } from './logging.ts';
import { createMailer, type Mailer } from './mail/mailer.ts';
import { MailService } from './mail/service.ts';
import { packageDir, projectRoot } from './paths.ts';
import { accountRoutes } from './routes/account.tsx';
import { adminRoutes } from './routes/admin.tsx';
import { registerErrorPages } from './routes/errors.tsx';
import { eventRoutes } from './routes/events.tsx';
import { waypointRoutes } from './routes/waypoints.tsx';
import { groupRoutes } from './routes/groups.tsx';
import { homeRoutes } from './routes/home.tsx';
import { identityRoutes } from './routes/identity.tsx';
import { mapRoutes } from './routes/map.tsx';
import { pageRoutes } from './routes/pages.ts';
import { privacyRoutes } from './routes/privacy.tsx';
import { settingsRoutes } from './routes/settings.tsx';
import { themeOf, themeRoutes } from './routes/theme.ts';
import { Tracking } from './tracking/tracking.ts';

/** Where the lines for stdout go next to the files: JSON in production, readable otherwise. */
async function stdoutStream(config: Config): Promise<DestinationStream> {
  if (config.NODE_ENV === 'production') return pino.destination(1);
  return pretty(PRETTY_OPTIONS);
}

/**
 * `mailer` can be replaced (tests capture the messages); by default it comes from the SMTP_*
 * settings. `logStream` makes the app write its JSON log lines there (tests read them).
 */
export async function buildApp(
  config: Config,
  pool: Pool,
  mailer?: Mailer,
  logStream?: NodeJS.WritableStream,
): Promise<FastifyInstance> {
  // Log files only when LOG_DIR is set, and never in tests:
  const files =
    config.LOG_DIR && !logStream && config.NODE_ENV !== 'test'
      ? await fileLogger(resolve(projectRoot(), config.LOG_DIR), await stdoutStream(config))
      : null;
  const app = Fastify({
    ...(files
      ? { loggerInstance: files.logger as FastifyBaseLogger }
      : {
          // JSON lines in production (for log tools), readable lines in development, nothing in
          // tests.
          logger: logStream
            ? { level: 'info', stream: logStream }
            : config.NODE_ENV === 'test'
              ? false
              : config.NODE_ENV === 'production'
                ? { level: 'info', timestamp: localIsoTime }
                : { transport: { target: 'pino-pretty', options: PRETTY_OPTIONS } },
        }),
    // Fastify's own two lines per request are replaced by the one line per page request below.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.NODE_ENV === 'production', // behind nginx in production
  });

  // Every HTML page gets the visitor's theme (Bootstrap's `data-bs-theme`) on <html>, so the right
  // colours are there from the first paint. Done here, once, instead of in every page.
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      typeof payload === 'string' &&
      String(reply.getHeader('content-type') ?? '').startsWith('text/html')
    )
      return payload
        .replace('<html lang="en">', `<html lang="en" data-bs-theme="${themeOf(request.cookies)}">`)
        .replace('mailto:ft-contact', () => `mailto:${config.MAIL_CONTACT_ADDRESS}`);

    return payload;
  });

  // One line per page request: "GET /register 200 14ms". Static files (CSS, JS, fonts, images) are
  // skipped, and the query string is left out because it can hold one-time tokens (emailed links)
  // and typed usernames or emails.
  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (path.startsWith('/assets/') || path.startsWith('/vendor/')) return;
    request.log.info(
      { user: request.user?.username },
      `${request.method} ${path} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`,
    );
  });

  // Static files first: routes registered before the session plugin do not run its per-request user
  // lookup.
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
  // The map page's script (`public/js/map/main.js`, from the legacy site) needs jQuery.
  await app.register(fastifyStatic, {
    root: join(packageDir('jquery'), 'dist'),
    prefix: '/vendor/jquery/',
    decorateReply: false,
  });

  await app.register(fastifyFormbody);
  // File uploads (waypoint files): one small file per request.
  await app.register(fastifyMultipart, {
    limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 5 },
  });
  await app.register(fastifyRateLimit, { global: false });
  await registerSession(app, config, pool);
  registerErrorPages(app);
  const mail = new MailService(config, pool, mailer ?? createMailer(config, app.log), app.log);
  app.decorate('mail', mail);
  await identityRoutes(app, pool, config, mail);
  await accountRoutes(app, pool, config, mail);
  const tracking = new Tracking(pool, app.log);
  app.decorate('tracking', tracking);
  await adminRoutes(app, pool, mail, tracking);
  await settingsRoutes(app, pool);
  await themeRoutes(app);
  await groupRoutes(app, pool);
  await eventRoutes(app, pool);
  await waypointRoutes(app, pool);
  await mapRoutes(app, pool, config, tracking);
  await homeRoutes(app, pool);
  await privacyRoutes(app, config);
  await pageRoutes(app);

  app.addHook('onClose', async () => {
    tracking.stop();
    await mail.flush();
    await pool.end();
    await files?.close();
  });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    mail: MailService;
    tracking: Tracking;
  }
}
