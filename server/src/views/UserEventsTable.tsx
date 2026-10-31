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

import type { UserEvent, UserEventsList } from '../repo/events.ts';
import { confirmAttrs, confirmDeleteEvent } from './confirmDelete.tsx';

function Row({ event }: { event: UserEvent; }) {
  return (
    <tr class={event.isDefault ? 'ft-default' : undefined}>
      <td class={`ft-name-cell ft-card-full ${event.isDefault ? 'fw-bold' : 'fw-semibold'}`}>
        {event.isDefault && '* '}
        {event.name}
      </td>
      <td class='text-end ft-card-full' data-label='Waypoints'>{event.waypoints}</td>
      <td class='text-end text-nowrap ft-card-link ft-actions'>
        <a class='ft-group-link' href={`/events/${event.id}`}>Edit</a>
        <a class='ft-danger-link' {...confirmAttrs(confirmDeleteEvent(event))}>Delete</a>
      </td>
    </tr>
  );
}

/** The signed-in user's events, in the same table style (and phone cards) as their pilot groups. */
export function UserEventsTable({ list: { events } }: { list: UserEventsList; }) {
  if (events.length === 0)
    return <p class='text-muted'>You don't have any events yet.</p>;
  return (
    <div class='table-responsive-xl ft-table-wrap ft-sticky-head ft-table-events'>
      <table class='table table-striped table-hover align-middle ft-table ft-cards mb-0'>
        <caption class='visually-hidden'>My events</caption>
        <thead>
          <tr>
            <th scope='col'>Event</th>
            <th scope='col' class='text-end'>Waypoints</th>
            <th scope='col'>
              <span class='visually-hidden'>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => <Row key={event.id} event={event} />)}
        </tbody>
      </table>
    </div>
  );
}
