import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from '../db.ts';
import { requireLogin } from './guards.ts';
import { authenticate } from './service.ts';

export const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(1024),
});

// Brute-force protection for the login endpoints (per client IP).
export const loginRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function authApiRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post('/api/login', { config: loginRateLimit }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'username and password are required' });

    const user = await authenticate(pool, parsed.data.username, parsed.data.password);
    if (!user) return reply.code(401).send({ error: 'Invalid username or password' });

    await request.session.regenerate();
    request.session.userId = user.id;
    return user;
  });

  app.post('/api/logout', async (request, reply) => {
    await request.session.destroy();
    return reply.code(204).send();
  });

  app.get('/api/me', { preHandler: requireLogin }, async (request) => request.user);
}
