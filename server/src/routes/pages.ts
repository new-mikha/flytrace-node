import { audit } from '../audit.ts';
import type { FastifyInstance } from 'fastify';
import { page } from './html.ts';

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/logout', async (request, reply) => {
    if (request.user) audit(request, 'logout', 'Logged out');
    await request.session.destroy();
    return reply.redirect('/', 302);
  });

  app.get('/403', async (request, reply) => {
    return reply.code(403).type('text/html').send(page('Access denied',
      '<p>You do not have permission to view that page.</p>', request.user));
  });
}
