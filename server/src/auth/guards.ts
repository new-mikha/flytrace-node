import type { FastifyReply, FastifyRequest } from 'fastify';

// The deny helpers return the reply: an async hook that sends must return it, or Fastify tries to send twice.
function denyAnonymous(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.redirect(`/login?returnUrl=${encodeURIComponent(request.url)}`, 302);
}

function denyForbidden(reply: FastifyReply): FastifyReply {
  return reply.redirect('/403', 302);
}

/** preHandler: the request must belong to a logged-in user. */
export async function requireLogin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!request.user) return denyAnonymous(request, reply);
}

/** preHandler factory: the logged-in user must hold `role` (e.g. "Admins"). */
export function requireRole(role: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    if (!request.user) return denyAnonymous(request, reply);
    if (!request.user.roles.includes(role)) return denyForbidden(reply);
  };
}
