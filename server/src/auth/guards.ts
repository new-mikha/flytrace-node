import type { FastifyReply, FastifyRequest } from 'fastify';

function isApi(request: FastifyRequest): boolean {
  return request.url.startsWith('/api/');
}

function denyAnonymous(request: FastifyRequest, reply: FastifyReply): void {
  if (isApi(request)) {
    reply.code(401).send({ error: 'Not logged in' });
  } else {
    reply.redirect(`/login?returnUrl=${encodeURIComponent(request.url)}`, 302);
  }
}

function denyForbidden(request: FastifyRequest, reply: FastifyReply): void {
  if (isApi(request)) {
    reply.code(403).send({ error: 'Forbidden' });
  } else {
    reply.redirect('/403', 302);
  }
}

/** preHandler: the request must belong to a logged-in user. */
export async function requireLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) denyAnonymous(request, reply);
}

/** preHandler factory: the logged-in user must hold `role` (e.g. "Admins"). */
export function requireRole(role: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) return denyAnonymous(request, reply);
    if (!request.user.roles.includes(role)) return denyForbidden(request, reply);
  };
}
