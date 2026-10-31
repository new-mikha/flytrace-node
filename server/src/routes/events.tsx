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

// The events part of the home page: "Create new event" and the switch between the single-event and
// multiple-events modes. The pages of one event (its waypoints and task) are not built yet.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../audit.ts';
import { requireLogin } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import {
  DEFAULT_RADIUS,
  deleteEvent,
  type EditableEvent,
  getEvent,
  MAX_RADIUS,
  renameEvent,
  saveTask,
  setStartTs,
  type TaskPoint,
} from '../repo/eventEditor.ts';
import { createEvent, ensureDefaultEvent } from '../repo/events.ts';
import { getSettings, saveSettings } from '../repo/settings.ts';
import { confirmDeleteEvent, ConfirmDeletePage } from '../views/confirmDelete.tsx';
import { type EventDraft, EventPage } from '../views/EventPages.tsx';
import { sendHtml } from '../views/render.tsx';
import { page } from './html.ts';
import { formFields, setFlash, takeFlash } from './util.ts';

const HIDE_HOURS = [0, 1, 2, 3, 5, 24];
const MAX_POINTS = 500;
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];

export async function eventRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const guard = { preHandler: requireLogin };

  // "Create new event": the next free "Event 01", "Event 02", ...
  app.post('/events', guard, async (request, reply) => {
    const event = await createEvent(pool, request.user!.id);
    audit(request, 'event.created', 'Event created', { eventId: event.id, name: event.name });
    setFlash(request, 'success', `Created "${event.name}". Give it a name, then set up its task.`);
    return reply.redirect(`/events/${event.id}`, 302);
  });

  const notFound = (request: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(404)
      .type('text/html; charset=utf-8')
      .send(page('Event not found', '<p>There is no such event.</p>', request.user ?? null));

  /**
   * The event, when it is the signed-in person's own; in the single-event mode only the default
   * event can be opened. Otherwise the reply is sent.
   */
  async function load(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<{ event: EditableEvent; single: boolean } | null> {
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
      await reply.redirect(`/events/${await ensureDefaultEvent(pool, user.id)}`, 302);
      return null;
    }
    return { event, single };
  }

  // The single-event mode's Today Task is the default event, made when there is none yet.
  app.get('/events/default', guard, async (request, reply) =>
    reply.redirect(`/events/${await ensureDefaultEvent(pool, request.user!.id)}`, 302),
  );

  app.get<{ Params: { id: string } }>('/events/:id', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    return sendHtml(
      reply,
      <EventPage user={request.user!} {...found} flash={takeFlash(request)} now={new Date()} />,
    );
  });

  const show = (
    request: FastifyRequest,
    reply: FastifyReply,
    found: { event: EditableEvent; single: boolean },
    draft: EventDraft,
  ) =>
    sendHtml(
      reply,
      <EventPage user={request.user!} {...found} draft={draft} now={new Date()} />,
      422,
    );

  const back = (
    request: FastifyRequest,
    reply: FastifyReply,
    event: { id: number },
    text: string,
    anchor = '',
  ) => {
    setFlash(request, 'success', text);
    return reply.redirect(`/events/${event.id}${anchor}`, 302);
  };

  app.post<{ Params: { id: string } }>('/events/:id', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    const { event } = found;
    const name = formFields(request, 'name').name.trim();
    if (!name)
      return show(request, reply, found, {
        name: { value: name, error: 'Enter a name for the event.' },
      });

    if (name.length > 256)
      return show(request, reply, found, { name: { value: name, error: 'The name is too long.' } });
    if (!(await renameEvent(pool, event.id, name)))
      return show(request, reply, found, {
        name: { value: name, error: `You already have an event named "${name}".` },
      });

    audit(request, 'event.renamed', 'Event renamed', {
      eventId: event.id,
      before: event.name,
      after: name,
    });
    return back(request, reply, event, 'Saved.');
  });

  // The task: the rows of waypoint + radius, in order (a row without a waypoint is dropped; no
  // radius means the default).
  app.post<{ Params: { id: string } }>('/events/:id/task', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    const { event } = found;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const wpts = asList(body.wpt);
    const radii = asList(body.radius);
    const rows = wpts.map((wpt, i) => ({ wpt: wpt.trim(), radius: (radii[i] ?? '').trim() }));
    const refuse = (error: string) => show(request, reply, found, { task: { rows, error } });
    const points: TaskPoint[] = [];
    for (const r of rows) {
      if (r.wpt === '') continue;
      const radius =
        r.radius === '' ? DEFAULT_RADIUS : /^\d{1,6}$/.test(r.radius) ? Number(r.radius) : 0;
      if (!/^\d{1,10}$/.test(r.wpt)) return refuse('Please choose the turn points from the lists.');
      if (radius < 1 || radius > MAX_RADIUS)
        return refuse(`The radius is a whole number of meters, 1 to ${MAX_RADIUS}.`);
      points.push({ waypointId: Number(r.wpt), radius });
    }
    if (points.length > MAX_POINTS) return refuse(`A task can have up to ${MAX_POINTS} points.`);
    if (!(await saveTask(pool, event.id, points)))
      return refuse('Please choose waypoints of this event.');
    audit(request, 'event.task', 'Task saved', {
      eventId: event.id,
      points: points.length,
      before: event.task.length,
    });
    return back(
      request,
      reply,
      event,
      points.length === 0
        ? 'The task is empty now.'
        : `Task saved (${points.length} point${points.length === 1 ? '' : 's'}).`,
    );
  });

  // "Hide old points" (older than now minus some hours) and "Restore old points".
  app.post<{ Params: { id: string } }>('/events/:id/hide-old', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    const hours = Number(formFields(request, 'hours').hours);
    if (!HIDE_HOURS.includes(hours))
      return back(request, reply, found.event, 'Please use one of the buttons.', '#old-points');
    await setStartTs(pool, found.event.id, new Date(Date.now() - hours * 3_600_000));
    audit(request, 'event.hide-old', 'Old points hidden', { eventId: found.event.id, hours });
    return back(request, reply, found.event, 'Old points are hidden now.', '#old-points');
  });

  app.post<{ Params: { id: string } }>('/events/:id/restore-old', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    await setStartTs(pool, found.event.id, null);
    audit(request, 'event.restore-old', 'Old points restored', { eventId: found.event.id });
    return back(request, reply, found.event, 'Old points are shown again.', '#old-points');
  });

  // Delete the whole event: the confirmation page (what the Delete link opens without JavaScript,
  // and the dialog's twin) and the delete.
  app.get<{ Params: { id: string } }>('/events/:id/delete', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    const { event } = found;
    // the single-event mode has one Today Task, which stays
    if (found.single) return reply.redirect(`/events/${event.id}`, 302);
    return sendHtml(
      reply,
      <ConfirmDeletePage
        user={request.user!}
        path={`/events/${event.id}`}
        confirm={confirmDeleteEvent({
          id: event.id,
          name: event.name,
          waypoints: event.waypoints.length,
          groups: event.groups,
        })}
      />,
    );
  });

  app.post<{ Params: { id: string } }>('/events/:id/delete', guard, async (request, reply) => {
    const found = await load(request, reply);
    if (!found) return reply;
    const { event } = found;
    if (found.single)
      return back(
        request,
        reply,
        event,
        'The Today Task cannot be deleted. Switch to the Multiple Events mode to manage events.',
      );

    await deleteEvent(pool, event.id);
    audit(request, 'event.deleted', 'Event deleted', {
      eventId: event.id,
      name: event.name,
      waypoints: event.waypoints.length,
      groups: event.groups,
    });
    setFlash(request, 'success', `Deleted the event "${event.name}".`);
    return reply.redirect('/', 302);
  });

  // The "Switch to the ... mode" links at the bottom of the home page's task panels: the same
  // preference as in Settings.
  app.post('/events-mode', guard, async (request, reply) => {
    const user = request.user!;
    const to = formFields(request, 'to').to === 'multiple' ? 'multiple' : 'single';
    const before = await getSettings(pool, user.id);
    if (before.eventsMode !== to) {
      await saveSettings(pool, user.id, { ...before, eventsMode: to });
      audit(request, 'settings.changed', 'Events mode changed', {
        setting: 'eventsMode',
        before: before.eventsMode,
        after: to,
      });
    }
    setFlash(
      request,
      'success',
      to === 'multiple'
        ? 'Switched to the Multiple Events mode.'
        : 'Switched to the Single Task mode.',
    );
    return reply.redirect('/', 302);
  });
}
