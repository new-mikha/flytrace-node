import fastifyFormbody from '@fastify/formbody';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { registerSession } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db.ts';
import { packageDir, projectRoot } from './paths.ts';
import { createMailer, type Mailer } from './mail/mailer.ts';
import { MailService } from './mail/service.ts';
import { accountRoutes } from './routes/account.tsx';
import { homeRoutes } from './routes/home.tsx';
import { identityRoutes } from './routes/identity.tsx';
import { pageRoutes } from './routes/pages.ts';

/**
 * `mailer` can be replaced (tests capture the messages); by default it comes from the SMTP_* settings.
 * `logStream` makes the app write its JSON log lines there (tests read them).
 */
export async function buildApp(config: Config, pool: Pool, mailer?: Mailer, logStream?: NodeJS.WritableStream): Promise<FastifyInstance> {
  const app = Fastify({
    // JSON lines in production (for log tools), readable lines in development, nothing in tests.
    logger: logStream ? { level: 'info', stream: logStream }
      : config.NODE_ENV === 'test' ? false
      : config.NODE_ENV === 'production' ? true
      : { transport: { target: 'pino-pretty', options: {
        translateTime: 'HH:MM:ss',
        // messages are written to be read on their own; the fields stay in the JSON logs of production
        ignore: 'pid,hostname,reqId,event,user,userId,to,subject,action,ip',
        messageFormat: '{msg}{if user} [{user}]{end}',
      } } },
    // Fastify's own two lines per request are replaced by the one line per page request below.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.NODE_ENV === 'production', // behind nginx in production
  });

  // One line per page request: "GET /register 200 14ms". Static files (CSS, JS, fonts, images) are skipped, and the
  // query string is left out because it can hold one-time tokens (emailed links) and typed usernames or emails.
  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (path.startsWith('/assets/') || path.startsWith('/vendor/')) return;
    request.log.info({ user: request.user?.username }, `${request.method} ${path} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`);
  });

  // Static files first: routes registered before the session plugin do not run its per-request user lookup.
  await app.register(fastifyStatic, { root: join(projectRoot(), 'public'), prefix: '/assets/' });
  await app.register(fastifyStatic, {
    root: join(packageDir('bootstrap'), 'dist'), prefix: '/vendor/bootstrap/', decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: packageDir('@fortawesome/fontawesome-free'), prefix: '/vendor/fontawesome/', decorateReply: false,
  });

  await app.register(fastifyFormbody);
  await app.register(fastifyRateLimit, { global: false });
  await registerSession(app, config, pool);
  const mail = new MailService(config, pool, mailer ?? createMailer(config, app.log), app.log);
  app.decorate('mail', mail);
  await identityRoutes(app, pool, config, mail);
  await accountRoutes(app, pool, config, mail);
  await homeRoutes(app, pool);
  await pageRoutes(app, pool);

  app.addHook('onClose', async () => {
    await mail.flush();
    await pool.end();
  });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance { mail: MailService }
}
