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

import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import { page } from './html.ts';

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/logout', async (request, reply) => {
    if (request.user) audit(request, 'logout', 'Logged out');
    await request.session.destroy();
    return reply.redirect('/', 302);
  });

  app.get('/403', async (request, reply) => {
    return reply
      .code(403)
      .type('text/html')
      .send(
        page('Access denied', '<p>You do not have permission to view that page.</p>', request.user),
      );
  });
}
