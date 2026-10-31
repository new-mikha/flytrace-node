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

// The waypoints manager: /events/:id/waypoints (and /events/default/waypoints). Owner only; the
// single-event mode has only the default event.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../audit.ts';
import { requireLogin } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import { type CoordFormat, hemisphereOf, isCoordFormat, parseCoord } from '../geo/coords.ts';
import { type EditableEvent, getEvent } from '../repo/eventEditor.ts';
import { ensureDefaultEvent } from '../repo/events.ts';
import { getSettings } from '../repo/settings.ts';
import {
  addWaypoint,
  checkWaypointText,
  deleteAllWaypoints,
  deleteWaypoint,
  getCoordPrefs,
  listWaypoints,
  parseWaypointSort,
  saveCoordPrefs,
  updateWaypoint,
  type WaypointInput,
} from '../repo/waypoints.ts';
import {
  confirmDeleteAllWaypoints,
  confirmDeleteWaypoint,
  ConfirmDeletePage,
} from '../views/confirmDelete.tsx';
import { sendHtml } from '../views/render.tsx';
import { type WaypointDraft, WaypointsPage } from '../views/WaypointPages.tsx';
import { page } from './html.ts';
import { setFlash, takeFlash } from './util.ts';

type Found = { event: EditableEvent; single: boolean };
type Body = Record<string, string | undefined>;

const text = (v: unknown) => (typeof v === 'string' ? v : '');

export async function waypointRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const guard = { preHandler: requireLogin };

  const notFound = (request: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(404)
      .type('text/html; charset=utf-8')
      .send(page('Event not found', '<p>There is no such event.</p>', request.user ?? null));

  async function load(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<Found | null> {
    const user = request.user!;
    const event = /^\d+$/.test(request.params.id)
      ? await getEvent(pool, Number(request.params.id))
      : null;
    if (!event || event.userId !== user.id) {
      if (event)
        audit(request, 'event.denied', 'Refused access to an event', { eventId: event.id });
      await notFound(request, reply);
      return null;
    }
    const single = (await getSettings(pool, user.id)).eventsMode === 'single';
    if (single && !event.isDefault) {
      await reply.redirect(`/events/${await ensureDefaultEvent(pool, user.id)}/waypoints`, 302);
      return null;
    }
    return { event, single };
  }

  async function show(
    request: FastifyRequest,
    reply: FastifyReply,
    found: Found,
    extra: { draft?: WaypointDraft; status?: number } = {},
  ) {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const edit = /^\d+$/.test(text(query.edit)) ? Number(query.edit) : undefined;
    const sort = parseWaypointSort(query.sort, query.dir);
    // shown once, by the page that follows the add or update; waypoint-editor.js keeps the mark
    // while the page stays open (it is never stored for a later visit)
    const highlightId = request.session.highlightWaypoint;
    request.session.highlightWaypoint = undefined;
    const [waypoints, prefs] = await Promise.all([
      listWaypoints(pool, found.event.id, sort),
      getCoordPrefs(pool, request.user!.id),
    ]);
    return sendHtml(
      reply,
      <WaypointsPage
        user={request.user!}
        {...found}
        waypoints={waypoints}
        prefs={prefs}
        sort={sort}
        editId={edit}
        highlightId={highlightId}
        flash={takeFlash(request)}
        draft={extra.draft}
      />,
      extra.status ?? 200,
    );
  }

  const back = (
    request: FastifyRequest,
    reply: FastifyReply,
    event: { id: number },
    msg: string,
    kind: 'success' | 'danger' = 'success',
    hash = '#waypoints',
  ) => {
    setFlash(request, kind, msg);
    return reply.redirect(`/events/${event.id}/waypoints${hash}`, 302);
  };

  app.get('/events/default/waypoints', guard, async (request, reply) =>
    reply.redirect(`/events/${await ensureDefaultEvent(pool, request.user!.id)}/waypoints`, 302),
  );

  app.get<{ Params: { id: string } }>('/events/:id/waypoints', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    return show(request, reply, found);
  });

  /** The posted fields as a waypoint, or the messages (keys: name, lat, lon, alt, description). */
  function readInput(
    body: Body,
    format: CoordFormat,
  ): { input: WaypointInput } | { errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    const name = text(body.name).trim();
    const description = text(body.description).trim() || null;
    const textError = checkWaypointText(name, description);
    if (textError) errors[name === '' || name.length > 50 ? 'name' : 'description'] = textError;
    const lat = parseCoord(body, 'lat', format);
    if ('error' in lat) errors.lat = lat.error;
    const lon = parseCoord(body, 'lon', format);
    if ('error' in lon) errors.lon = lon.error;
    const altText = text(body.alt).trim().replace(',', '.');
    const alt = Number(altText);
    if (altText === '' || !/^[+-]?\d+(\.\d*)?$|^[+-]?\.\d+$/.test(altText) || !Number.isFinite(alt))
      errors.alt = 'Altitude should be a number of meters, like 650';
    else if (Math.abs(alt) > 100000) errors.alt = 'Altitude should be within ±100000 meters';
    if (Object.keys(errors).length > 0) return { errors };
    return {
      input: {
        name,
        description,
        lat: (lat as { value: number }).value,
        lon: (lon as { value: number }).value,
        alt,
      },
    };
  }

  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    found: Found,
    values: Body,
    errors: Record<string, string>,
    editId?: number,
  ) => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) clean[k] = text(v);
    return show(request, reply, found, { draft: { values: clean, errors, editId }, status: 422 });
  };

  // Add by hand; the default hemispheres follow what was typed (legacy).
  app.post<{ Params: { id: string } }>('/events/:id/waypoints', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    const body = (request.body ?? {}) as Body;
    const prefs = await getCoordPrefs(pool, request.user!.id);
    const read = readInput(body, prefs.format);
    if ('errors' in read) return refuse(request, reply, found, body, read.errors);
    const result = await addWaypoint(pool, found.event.id, read.input);
    if (!result.ok) return refuse(request, reply, found, body, { name: result.error });
    await saveCoordPrefs(pool, request.user!.id, {
      ns: hemisphereOf(read.input.lat, 'lat') as 'N' | 'S',
      ew: hemisphereOf(read.input.lon, 'lon') as 'E' | 'W',
    });
    audit(request, 'waypoint.added', 'Waypoint added', {
      eventId: found.event.id,
      waypointId: result.id,
      name: read.input.name,
    });
    request.session.highlightWaypoint = result.id;
    return back(
      request,
      reply,
      found.event,
      `Added the waypoint '${read.input.name}'.`,
      'success',
      `#wpt-${result.id}`,
    );
  });

  app.post<{ Params: { id: string; wid: string } }>(
    '/events/:id/waypoints/:wid',
    guard,
    async (request, reply) => {
      const found = await load(request, reply);
      if (!found) return reply;
      const wid = /^\d+$/.test(request.params.wid) ? Number(request.params.wid) : 0;
      const body = (request.body ?? {}) as Body;
      const prefs = await getCoordPrefs(pool, request.user!.id);
      const read = readInput(body, prefs.format);
      if ('errors' in read) return refuse(request, reply, found, body, read.errors, wid);
      const result = await updateWaypoint(pool, found.event.id, wid, read.input);
      if (!result.ok) {
        if (result.error === 'gone')
          return back(
            request,
            reply,
            found.event,
            'That waypoint is not there any more.',
            'danger',
          );
        return refuse(request, reply, found, body, { name: result.error }, wid);
      }
      audit(request, 'waypoint.updated', 'Waypoint updated', {
        eventId: found.event.id,
        waypointId: wid,
        name: read.input.name,
      });
      request.session.highlightWaypoint = wid;
      return back(
        request,
        reply,
        found.event,
        `Updated the waypoint '${read.input.name}'.`,
        'success',
        `#wpt-${wid}`,
      );
    },
  );

  // Delete: the confirmation page (what the Delete link opens without JavaScript) and the delete.
  app.get<{ Params: { id: string; wid: string } }>(
    '/events/:id/waypoints/:wid/delete',
    guard,
    async (request, reply) => {
      const found = await load(request, reply);
      if (!found) return reply;
      const w = (await listWaypoints(pool, found.event.id, { key: 'name', dir: 'asc' })).find(
        (x) => String(x.id) === request.params.wid,
      );
      if (!w)
        return back(request, reply, found.event, 'That waypoint is not there any more.', 'danger');
      return sendHtml(
        reply,
        <ConfirmDeletePage
          user={request.user!}
          path={`/events/${found.event.id}/waypoints`}
          confirm={confirmDeleteWaypoint(found.event, w)}
        />,
      );
    },
  );

  app.post<{ Params: { id: string; wid: string } }>(
    '/events/:id/waypoints/:wid/delete',
    guard,
    async (request, reply) => {
      const found = await load(request, reply);
      if (!found) return reply;
      const wid = /^\d+$/.test(request.params.wid) ? Number(request.params.wid) : 0;
      const result = await deleteWaypoint(pool, found.event.id, wid);
      if (!result.ok)
        return back(
          request,
          reply,
          found.event,
          result.error === 'gone' ? 'That waypoint is not there any more.' : result.error,
          'danger',
        );
      audit(request, 'waypoint.deleted', 'Waypoint deleted', {
        eventId: found.event.id,
        waypointId: wid,
        name: result.name,
      });
      return back(request, reply, found.event, `Deleted the waypoint '${result.name}'.`);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/events/:id/waypoints/delete-all',
    guard,
    async (request, reply) => {
      const found = await load(request, reply);
      if (!found) return reply;
      return sendHtml(
        reply,
        <ConfirmDeletePage
          user={request.user!}
          path={`/events/${found.event.id}/waypoints`}
          confirm={confirmDeleteAllWaypoints(found.event, found.event.waypoints.length)}
        />,
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    '/events/:id/waypoints/delete-all',
    guard,
    async (request, reply) => {
      const found = await load(request, reply);
      if (!found) return reply;
      const n = await deleteAllWaypoints(pool, found.event.id);
      audit(request, 'waypoint.deleted-all', 'All waypoints deleted', {
        eventId: found.event.id,
        waypoints: n,
        task: found.event.task.length,
      });
      return back(
        request,
        reply,
        found.event,
        n === 0 ? 'There were no waypoints.' : `Deleted all ${n} waypoints.`,
      );
    },
  );

  // The coordinates format is a preference of the person (it is also used on their next visit).
  app.post<{ Params: { id: string } }>(
    '/events/:id/waypoints/format',
    guard,
    async (request, reply) => {
      const found = await load(request, reply);
      if (!found) return reply;
      const format = text(((request.body ?? {}) as Body).format);
      if (!isCoordFormat(format))
        return back(request, reply, found.event, 'Please choose one of the formats.', 'danger');
      const before = await getCoordPrefs(pool, request.user!.id);
      if (before.format !== format) {
        await saveCoordPrefs(pool, request.user!.id, { format });
        audit(request, 'settings.changed', 'Coordinates format changed', {
          setting: 'coordFormat',
          before: before.format,
          after: format,
        });
      }
      return reply.redirect(`/events/${found.event.id}/waypoints#waypoints`, 302);
    },
  );
}
