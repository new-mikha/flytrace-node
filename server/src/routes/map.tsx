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
import type { Config } from '../config.ts';
import type { Pool } from '../db.ts';
import { getMapGroup } from '../repo/mapGroups.ts';
import { fakeCoordinates, fakeTracks, restartFakeGroup } from '../tracking/fake.ts';
import type { TrackRequest } from '../tracking/wire.ts';
import { MapPage } from '../views/MapPage.tsx';
import { sendHtml } from '../views/render.tsx';

/** The most trackers whose tracks the page asks for at once (the script sends up to this many). */
const MAX_TRACKS_PER_REQUEST = 10;

const idOf = (raw: string): number => (/^\d{1,10}$/.test(raw) ? Number(raw) : 0);

/**
 * A group's map and the two requests its script makes. Public, as the legacy map was: anybody with the
 * address of a group can look at it. The answers are made up for now (`tracking/fake.ts`).
 */
export async function mapRoutes(app: FastifyInstance, pool: Pool, config: Config): Promise<void> {
  // Google's own Map ID for trying things out: with it, and with no key at all, the map still works
  // while developing (watermarked, with a dialog that can be closed). Not used in production.
  const mapId =
    config.GOOGLE_MAPS_MAP_ID ?? (config.NODE_ENV === 'production' ? undefined : 'DEMO_MAP_ID');

  // A group that does not exist goes to the home page, as in the legacy site.
  app.get<{ Params: { id: string } }>('/map/:id', async (request, reply) => {
    const group = await getMapGroup(pool, idOf(request.params.id));
    if (!group) return reply.redirect('/', 302);

    restartFakeGroup(group.id);
    return sendHtml(
      reply,
      <MapPage
        groupId={group.id}
        groupName={group.name}
        mapsKey={config.GOOGLE_MAPS_API_KEY}
        mapId={mapId}
      />,
    );
  });

  // The latest position of every tracker of the group.
  app.get<{ Params: { id: string } }>('/map/:id/coordinates', async (request, reply) => {
    const group = await getMapGroup(pool, idOf(request.params.id));
    if (!group) return reply.code(404).send({ error: 'No such group' });

    return reply.header('cache-control', 'no-store').send(fakeCoordinates(group.id));
  });

  // The tracks of some of the trackers; a POST only because the list of names and times is too long
  // for an address.
  app.post<{ Params: { id: string }; Body: unknown }>('/map/:id/tracks', async (request, reply) => {
    const group = await getMapGroup(pool, idOf(request.params.id));
    if (!group) return reply.code(404).send({ error: 'No such group' });

    const items = (request.body as TrackRequest | null)?.Items;
    if (
      !Array.isArray(items) ||
      items.length > MAX_TRACKS_PER_REQUEST ||
      items.some((item) => typeof item?.TrackerName !== 'string' || item.TrackerName === '')
    )
      return reply.code(400).send({ error: 'Bad request' });

    return reply.header('cache-control', 'no-store').send(fakeTracks(group.id, { Items: items }));
  });
}
