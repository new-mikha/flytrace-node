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

import type { Pool } from '../db.ts';

export interface UserEvent {
  id: number;
  name: string;
  waypoints: number;
  /** The user's default event: new groups use it (the legacy "*"). */
  isDefault: boolean;
}

export interface UserEventsList {
  events: UserEvent[];
  /** Legacy rule: the events list is for the multiple-events mode; single-event mode has just the default event ("Today Task"). */
  show: boolean;
}

/** The events a user owns, by name. */
export async function listUserEvents(pool: Pool, userId: string): Promise<UserEventsList> {
  const [list, profile] = await Promise.all([
    pool.query<{ id: number; name: string; waypoints: number; is_default: boolean }>(
      `SELECT e.id, e.name, (up.default_event_id = e.id) AS is_default,
              (SELECT count(*)::int FROM waypoints w WHERE w.event_id = e.id) AS waypoints
       FROM events e LEFT JOIN user_profiles up ON up.user_id = e.user_id
       WHERE e.user_id = $1 ORDER BY lower(e.name), e.id`,
      [userId],
    ),
    pool.query<{ simple: boolean }>('SELECT is_simple_events_model AS simple FROM user_profiles WHERE user_id = $1', [userId]),
  ]);
  return {
    events: list.rows.map((r) => ({ id: r.id, name: r.name, waypoints: r.waypoints, isDefault: r.is_default === true })),
    show: !(profile.rows[0]?.simple ?? true),
  };
}
