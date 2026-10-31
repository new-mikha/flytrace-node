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
import { getTodayTask, listUserEvents } from '../repo/events.ts';
import { listOthersGroups, listPublicGroups, listUserGroups } from '../repo/groups.ts';
import { HomePage, PublicMaps } from '../views/HomePage.tsx';
import { sendFragment, sendHtml } from '../views/render.tsx';
import { UserHomePage } from '../views/UserHomePage.tsx';
import { takeFlash } from './util.ts';

export async function homeRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // `?all=1`: the full list. `?fragment=1`: only the list section, which public/js/app.js swaps into the open page
  // so that the address bar keeps its short URL and a refresh shows the short list again.
  // Signed in, `?others=1` adds other people's groups under their own (with `all=1` for the full list).
  app.get<{ Querystring: { all?: string; fragment?: string; others?: string } }>(
    '/',
    async (request, reply) => {
      if (request.user) {
        // signed in: their own groups instead of the introduction and the public maps
        const user = request.user;
        const showAll = request.query.all === '1';
        const [list, events, today, others] = await Promise.all([
          listUserGroups(pool, user.id),
          listUserEvents(pool, user.id),
          getTodayTask(pool, user.id),
          request.query.others === '1'
            ? listOthersGroups(pool, user.id, {
                all: showAll,
                admin: user.roles.includes('Admins'),
              })
            : null,
        ]);
        return sendHtml(
          reply,
          <UserHomePage
            user={user}
            path={request.url}
            list={list}
            events={events}
            today={today}
            now={new Date()}
            others={others && { list: others, showAll }}
            flash={takeFlash(request)}
          />,
        );
      }
      const showAll = request.query.all === '1';
      const { groups, total } = await listPublicGroups(pool, { all: showAll });
      const now = new Date();
      if (request.query.fragment === '1')
        return sendFragment(
          reply,
          <PublicMaps groups={groups} total={total} showAll={showAll} now={now} />,
        );

      return sendHtml(
        reply,
        <HomePage
          user={request.user}
          path={request.url}
          groups={groups}
          total={total}
          showAll={showAll}
          now={now}
        />,
      );
    },
  );
}
