import { audit } from '../audit.ts';
import type { FastifyInstance } from 'fastify';
import { requireLogin, requireRole } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import { esc, page } from './html.ts';

export async function pageRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post('/logout', async (request, reply) => {
    if (request.user) audit(request, 'logout', 'Logged out');
    await request.session.destroy();
    return reply.redirect('/', 302);
  });

  app.get('/403', async (request, reply) => {
    return reply.code(403).type('text/html').send(page('Access denied',
      '<p>You do not have permission to view that page.</p>', request.user));
  });

  app.get('/groups', { preHandler: requireLogin }, async (request, reply) => {
    const { rows } = await pool.query<{ id: number; name: string; is_public: boolean; trackers: string; newest_coord_ts: Date | null }>(
      `SELECT g.id, g.name, g.is_public, g.newest_coord_ts,
              (SELECT count(*) FROM group_trackers t WHERE t.group_id = g.id) AS trackers
       FROM groups g WHERE g.user_id = $1 ORDER BY g.name`,
      [request.user!.id],
    );
    const trs = rows.map((g) => `<tr><td>${g.id}</td><td>${esc(g.name)}</td><td>${g.is_public ? 'yes' : 'no'}</td>
      <td>${esc(g.trackers)}</td><td>${g.newest_coord_ts ? esc(g.newest_coord_ts.toISOString()) : ''}</td></tr>`).join('');
    return reply.type('text/html').send(page('My groups', rows.length
      ? `<table><tr><th>Id</th><th>Name</th><th>Public</th><th>Trackers</th><th>Last position</th></tr>${trs}</table>`
      : '<p>You have no groups.</p>', request.user));
  });

  app.get<{ Querystring: { page?: string } }>('/admin', { preHandler: requireRole('Admins') }, async (request, reply) => {
    const pageSize = 50;
    const pageNo = Math.max(1, Number(request.query.page) || 1);
    const { rows } = await pool.query<{ username: string; email: string | null; roles: string[]; groups: string; last_login_at: Date | null }>(
      `SELECT u.username, u.email, u.last_login_at,
              COALESCE(array_agg(r.name::text) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
              (SELECT count(*) FROM groups g WHERE g.user_id = u.id) AS groups
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       GROUP BY u.id ORDER BY u.username LIMIT $1 OFFSET $2`,
      [pageSize, (pageNo - 1) * pageSize],
    );
    const trs = rows.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.email)}</td><td>${esc(u.roles.join(', '))}</td>
      <td>${esc(u.groups)}</td><td>${u.last_login_at ? esc(u.last_login_at.toISOString().slice(0, 10)) : ''}</td></tr>`).join('');
    return reply.type('text/html').send(page('Users (admin)', `
      <table><tr><th>Username</th><th>Email</th><th>Roles</th><th>Groups</th><th>Last login</th></tr>${trs}</table>
      <p>${pageNo > 1 ? `<a href="/admin?page=${pageNo - 1}">Previous</a> ` : ''}${rows.length === pageSize ? `<a href="/admin?page=${pageNo + 1}">Next</a>` : ''}</p>`,
      request.user));
  });
}
