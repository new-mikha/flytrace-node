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

import type { FastifyReply, FastifyRequest } from 'fastify';

// The deny helpers return the reply: an async hook that sends must return it, or Fastify tries to
// send twice.
function denyAnonymous(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.redirect(`/login?returnUrl=${encodeURIComponent(request.url)}`, 302);
}

function denyForbidden(reply: FastifyReply): FastifyReply {
  return reply.redirect('/403', 302);
}

/** preHandler: the request must belong to a logged-in user. */
export async function requireLogin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  if (!request.user) return denyAnonymous(request, reply);
}

/** preHandler factory: the logged-in user must hold `role` (e.g. "Admins"). */
export function requireRole(role: string) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    if (!request.user) return denyAnonymous(request, reply);
    if (!request.user.roles.includes(role)) return denyForbidden(reply);
  };
}
