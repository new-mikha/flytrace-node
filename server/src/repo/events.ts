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

import type { Client, Pool } from '../db.ts';
import { withTransaction } from '../db.ts';

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

/** `Event 01`, `Event 02`, ...: the first free number (the legacy names). Safe inside a transaction (a clash retries instead of failing). */
export async function createEvent(db: Pool | Client, userId: string): Promise<{ id: number; name: string }> {
  for (;;) {
    const { rows } = await db.query<{ name: string }>('SELECT name FROM events WHERE user_id = $1', [userId]);
    const used = new Set(rows.map((r) => r.name.toLowerCase()));
    let n = 1;
    while (used.has(`event ${String(n).padStart(2, '0')}`)) n++;
    const name = `Event ${String(n).padStart(2, '0')}`;
    const { rows: [e] } = await db.query<{ id: number }>(
      'INSERT INTO events (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [userId, name]);
    if (e) return { id: e.id, name }; // no row: two creations at once picked the same name, look again
  }
}

/** The user's default event ("Today Task" in the single-event mode), made when there is none yet (legacy EnsureDefaultTask). */
export async function ensureDefaultEvent(pool: Pool, userId: string): Promise<number> {
  return withTransaction(pool, async (c) => {
    await c.query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
    const { rows: [p] } = await c.query<{ default_event_id: number | null }>(
      'SELECT default_event_id FROM user_profiles WHERE user_id = $1 FOR UPDATE', [userId]);
    if (p?.default_event_id) return p.default_event_id;
    const event = await createEvent(c, userId);
    await c.query('UPDATE user_profiles SET default_event_id = $2 WHERE user_id = $1', [userId, event.id]);
    return event.id;
  });
}

/** The "Today Task" panel of the single-event mode: the default event and what it holds (legacy GetDefaultEventParams). */
export interface TodayTask {
  eventId: number | null;
  waypoints: number;
  taskWaypoints: number;
}

export async function getTodayTask(pool: Pool, userId: string): Promise<TodayTask> {
  const { rows: [r] } = await pool.query<{ id: number | null; waypoints: number; task: number }>(
    `SELECT up.default_event_id AS id,
            (SELECT count(*)::int FROM waypoints w WHERE w.event_id = up.default_event_id) AS waypoints,
            (SELECT count(*)::int FROM tasks t JOIN waypoints w ON w.id = t.waypoint_id WHERE w.event_id = up.default_event_id) AS task
     FROM user_profiles up WHERE up.user_id = $1`, [userId]);
  return { eventId: r?.id ?? null, waypoints: r?.waypoints ?? 0, taskWaypoints: r?.task ?? 0 };
}

/**
 * Show an event's task on a group's map, or nothing (`null`). False when the event is not the group owner's. Choosing an event
 * also makes it the owner's default event, which new groups use (legacy AssignEventToGroup). Bumps the group's version.
 */
export async function assignEvent(pool: Pool, groupId: number, ownerId: string, eventId: number | null): Promise<boolean> {
  return withTransaction(pool, async (c) => {
    if (eventId !== null) {
      const { rowCount } = await c.query('SELECT 1 FROM events WHERE id = $1 AND user_id = $2', [eventId, ownerId]);
      if (!rowCount) return false;
    }
    await c.query('UPDATE groups SET event_id = $2, version = version + 1 WHERE id = $1', [groupId, eventId]);
    if (eventId !== null) {
      await c.query(
        `INSERT INTO user_profiles (user_id, default_event_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET default_event_id = EXCLUDED.default_event_id`, [ownerId, eventId]);
    }
    return true;
  });
}
