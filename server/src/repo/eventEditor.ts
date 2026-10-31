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

// One event as its page (/events/:id) shows it, and the changes the page makes. Every change that the maps can see (the task, the
// "hide old points" threshold, deleting the event) bumps `groups.version` of the groups that use the event, in the same transaction.
import type { Client, Pool } from '../db.ts';
import { withTransaction } from '../db.ts';

export interface EventWaypoint {
  id: number;
  name: string;
}

export interface TaskPoint {
  waypointId: number;
  radius: number;
}

export interface EditableEvent {
  id: number;
  userId: string;
  name: string;
  /** "Hide old points": maps show only points newer than this. */
  startTs: Date | null;
  /** The owner's default event: new groups use it (the Today Task of the single-event mode). */
  isDefault: boolean;
  /** In the order they were added. */
  waypoints: EventWaypoint[];
  task: TaskPoint[];
  /** How many of the owner's groups show this event. */
  groups: number;
}

export const MAX_RADIUS = 100000;
export const DEFAULT_RADIUS = 400;

export async function getEvent(pool: Pool, id: number): Promise<EditableEvent | null> {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) return null;
  const {
    rows: [e],
  } = await pool.query<{
    id: number;
    user_id: string;
    name: string;
    start_ts: Date | null;
    is_default: boolean;
    groups: number;
  }>(
    `SELECT e.id, e.user_id, e.name, e.start_ts, (up.default_event_id = e.id) AS is_default,
            (SELECT count(*)::int FROM groups g WHERE g.event_id = e.id) AS groups
     FROM events e LEFT JOIN user_profiles up ON up.user_id = e.user_id WHERE e.id = $1`,
    [id],
  );
  if (!e) return null;
  const [waypoints, task] = await Promise.all([
    pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM waypoints WHERE event_id = $1 ORDER BY id',
      [id],
    ),
    pool.query<{ waypoint_id: number; radius: number }>(
      `SELECT t.waypoint_id, t.radius FROM tasks t JOIN waypoints w ON w.id = t.waypoint_id WHERE w.event_id = $1 ORDER BY t.wpt_order, t.id`,
      [id],
    ),
  ]);
  return {
    id: e.id,
    userId: e.user_id,
    name: e.name,
    startTs: e.start_ts,
    isDefault: e.is_default === true,
    groups: e.groups,
    waypoints: waypoints.rows,
    task: task.rows.map((t) => ({ waypointId: t.waypoint_id, radius: t.radius })),
  };
}

const bumpGroups = (c: Client, eventId: number) =>
  c.query('UPDATE groups SET version = version + 1 WHERE event_id = $1', [eventId]);

/** False when the owner already has another event with that name. */
export async function renameEvent(pool: Pool, eventId: number, name: string): Promise<boolean> {
  try {
    await pool.query('UPDATE events SET name = $2 WHERE id = $1', [eventId, name]);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return false;
    throw err;
  }
}

/** The groups that showed the event show nothing afterwards; the waypoints and the task go with it. */
export async function deleteEvent(pool: Pool, eventId: number): Promise<void> {
  await withTransaction(pool, async (c) => {
    await bumpGroups(c, eventId);
    await c.query('DELETE FROM events WHERE id = $1', [eventId]); // groups.event_id and the default event are set to NULL by the schema
  });
}

/** Replace the task (legacy: delete all the rows and insert again, in order). False when a waypoint is not the event's. */
export async function saveTask(pool: Pool, eventId: number, points: TaskPoint[]): Promise<boolean> {
  return withTransaction(pool, async (c) => {
    const ids = [...new Set(points.map((p) => p.waypointId))];
    if (ids.length > 0) {
      const { rows } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM waypoints WHERE event_id = $1 AND id = ANY($2::int[])',
        [eventId, ids],
      );
      if (rows[0]!.n !== ids.length) return false;
    }
    await bumpGroups(c, eventId);
    await c.query(
      'DELETE FROM tasks WHERE waypoint_id IN (SELECT id FROM waypoints WHERE event_id = $1)',
      [eventId],
    );
    for (const [i, p] of points.entries())
      await c.query('INSERT INTO tasks (waypoint_id, radius, wpt_order) VALUES ($1, $2, $3)', [
        p.waypointId,
        p.radius,
        i,
      ]);

    return true;
  });
}

/** "Hide old points": maps show only points newer than `since` (null: all of them again). */
export async function setStartTs(pool: Pool, eventId: number, since: Date | null): Promise<void> {
  await withTransaction(pool, async (c) => {
    await bumpGroups(c, eventId);
    await c.query('UPDATE events SET start_ts = $2 WHERE id = $1', [eventId, since]);
  });
}
