import fastifyFormbody from '@fastify/formbody';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { authApiRoutes } from './auth/routes.ts';
import { registerSession } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db.ts';
import { packageDir, projectRoot } from './paths.ts';
import { homeRoutes } from './routes/home.tsx';
import { pageRoutes } from './routes/pages.ts';

export async function buildApp(config: Config, pool: Pool): Promise<FastifyInstance> {
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
  await authApiRoutes(app, pool);
  await homeRoutes(app, pool);
  await pageRoutes(app, pool);

  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}
