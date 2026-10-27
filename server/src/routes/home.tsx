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
import type { Pool } from '../db.ts';
import { listUserEvents } from '../repo/events.ts';
import { listPublicGroups, listUserGroups } from '../repo/groups.ts';
import { HomePage, PublicMaps } from '../views/HomePage.tsx';
import { UserHomePage } from '../views/UserHomePage.tsx';
import { sendFragment, sendHtml } from '../views/render.tsx';

export async function homeRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // `?all=1`: the full list. `?fragment=1`: only the list section, which public/js/app.js swaps into the open page
  // so that the address bar keeps its short URL and a refresh shows the short list again.
  app.get<{ Querystring: { all?: string; fragment?: string } }>('/', async (request, reply) => {
    if (request.user) { // signed in: their own groups instead of the introduction and the public maps
      const [list, events] = await Promise.all([listUserGroups(pool, request.user.id), listUserEvents(pool, request.user.id)]);
      return sendHtml(reply, <UserHomePage user={request.user} path={request.url} list={list} events={events} now={new Date()} />);
    }
    const showAll = request.query.all === '1';
    const { groups, total } = await listPublicGroups(pool, { all: showAll });
    const now = new Date();
    if (request.query.fragment === '1') {
      return sendFragment(reply, <PublicMaps groups={groups} total={total} showAll={showAll} now={now} />);
    }
    return sendHtml(reply,
      <HomePage user={request.user} path={request.url} groups={groups} total={total} showAll={showAll} now={now} />);
  });
}
