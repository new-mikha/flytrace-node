import fastifyFormbody from '@fastify/formbody';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { authApiRoutes } from './auth/routes.ts';
import { registerSession } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db.ts';
import { pageRoutes } from './routes/pages.ts';

export async function buildApp(config: Config, pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    trustProxy: config.NODE_ENV === 'production', // behind nginx in production
  });

  await app.register(fastifyFormbody);
  await app.register(fastifyRateLimit, { global: false });
  await registerSession(app, config, pool);
  await authApiRoutes(app, pool);
  await pageRoutes(app, pool);

  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}
