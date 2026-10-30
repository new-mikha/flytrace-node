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

// The events part of the home page: "Create new event" and the switch between the single-event and multiple-events modes.
// The pages of one event (its waypoints and task) are not built yet.
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import { requireLogin } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import { createEvent } from '../repo/events.ts';
import { getSettings, saveSettings } from '../repo/settings.ts';
import { formFields, setFlash } from './util.ts';

export async function eventRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const guard = { preHandler: requireLogin };

  // "Create new event": the next free "Event 01", "Event 02", ...
  app.post('/events', guard, async (request, reply) => {
    const event = await createEvent(pool, request.user!.id);
    audit(request, 'event.created', 'Event created', { eventId: event.id, name: event.name });
    setFlash(request, 'success', `Created "${event.name}".`);
    return reply.redirect('/', 302);
  });

  // The "Switch to the ... mode" links at the bottom of the home page's task panels: the same preference as in Settings.
  app.post('/events-mode', guard, async (request, reply) => {
    const user = request.user!;
    const to = formFields(request, 'to').to === 'multiple' ? 'multiple' : 'single';
    const before = await getSettings(pool, user.id);
    if (before.eventsMode !== to) {
      await saveSettings(pool, user.id, { ...before, eventsMode: to });
      audit(request, 'settings.changed', 'Events mode changed', { setting: 'eventsMode', before: before.eventsMode, after: to });
    }
    setFlash(request, 'success', to === 'multiple' ? 'Switched to the Multiple Events mode.' : 'Switched to the Single Task mode.');
    return reply.redirect('/', 302);
  });
}
