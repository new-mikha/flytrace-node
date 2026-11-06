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

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorPage } from '../views/ErrorPage.tsx';
import { sendHtml } from '../views/render.tsx';

/**
 * A person gets a page; whatever else asks (the map's requests, an image, a script) gets a line of
 * JSON, which it can tell from an answer by the status.
 */
function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  title: string,
  message: string,
): FastifyReply {
  if (!request.headers.accept?.includes('text/html'))
    return reply.code(status).send({ error: title });

  const page = (
    <ErrorPage
      user={request.user ?? null}
      path={request.url.split('?')[0]!}
      title={title}
      message={message}
    />
  );
  return sendHtml(reply, page, status);
}

/** For addresses nothing answers, and for what goes wrong while answering. */
export function registerErrorPages(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendError(
      request,
      reply,
      404,
      'Page not found',
      'There is nothing at this address. It may have been mistyped, or the page may be gone.',
    ),
  );

  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status === 429)
      return sendError(
        request,
        reply,
        status,
        'Too many requests',
        'Please wait a minute and try again.',
      );

    if (status < 500)
      return sendError(
        request,
        reply,
        status,
        'That did not work',
        'We could not make sense of that request.',
      );

    // The details are for the log only: they may show how things work inside.
    request.log.error({ err }, err.message);
    return sendError(
      request,
      reply,
      status,
      'Something went wrong',
      'That was our fault, not yours. Please try again in a moment.',
    );
  });
}
