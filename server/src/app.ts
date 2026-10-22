import fastifyFormbody from '@fastify/formbody';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
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

/** `mailer` can be replaced (tests capture the messages); by default it comes from the SMTP_* settings. */
export async function buildApp(config: Config, pool: Pool, mailer?: Mailer): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    trustProxy: config.NODE_ENV === 'production', // behind nginx in production
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
