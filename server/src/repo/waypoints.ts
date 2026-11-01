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

// The waypoints of one event as the manager page (/events/:id/waypoints) shows and changes them.
// Every change bumps `groups.version` of the groups that show the event, in the same transaction.
import type { Client, Pool } from '../db.ts';
import { withTransaction } from '../db.ts';
import type { CoordFormat } from '../geo/coords.ts';
import { isCoordFormat } from '../geo/coords.ts';

export interface ManagedWaypoint {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  description: string | null;
  /** In the task of the event. */
  inTask: boolean;
}

export type WaypointSortKey = 'name' | 'lat' | 'lon' | 'alt' | 'description';
export interface WaypointSort {
  key: WaypointSortKey;
  dir: 'asc' | 'desc';
}
export const DEFAULT_WAYPOINT_SORT: WaypointSort = { key: 'name', dir: 'asc' };

export function parseWaypointSort(key: unknown, dir: unknown): WaypointSort {
  const keys: WaypointSortKey[] = ['name', 'lat', 'lon', 'alt', 'description'];
  const k = keys.find((x) => x === key);
  if (!k) return DEFAULT_WAYPOINT_SORT;
  return { key: k, dir: dir === 'desc' ? 'desc' : 'asc' };
}

export interface WaypointInput {
  name: string;
  lat: number;
  lon: number;
  alt: number;
  description: string | null;
}

export type WaypointResult = { ok: true; id: number } | { ok: false; error: string };

/** Natural order of names ("WPT2" before "WPT10"), whatever the case. */
const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export async function listWaypoints(
  pool: Pool,
  eventId: number,
  sort: WaypointSort,
): Promise<ManagedWaypoint[]> {
  const { rows } = await pool.query<{
    id: number;
    name: string;
    lat: number;
    lon: number;
    alt: number;
    description: string | null;
    in_task: boolean;
  }>(
    `SELECT w.id, w.name, w.lat, w.lon, w.alt, w.description,
            EXISTS (SELECT 1 FROM tasks t WHERE t.waypoint_id = w.id) AS in_task
     FROM waypoints w WHERE w.event_id = $1 ORDER BY w.id`,
    [eventId],
  );
  const list = rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    alt: r.alt,
    description: r.description,
    inTask: r.in_task,
  }));
  const sign = sort.dir === 'asc' ? 1 : -1;
  const compare = (a: ManagedWaypoint, b: ManagedWaypoint) => {
    if (sort.key === 'name') return byName(a.name, b.name);
    if (sort.key === 'description') return byName(a.description ?? '', b.description ?? '');
    return a[sort.key] - b[sort.key];
  };
  return list.sort((a, b) => sign * compare(a, b) || byName(a.name, b.name) || a.id - b.id);
}

const bumpGroups = (c: Client, eventId: number) =>
  c.query('UPDATE groups SET version = version + 1 WHERE event_id = $1', [eventId]);

const used = (name: string) => `'${name}' has already been used as a waypoint name`;

/** A waypoint of the event with that name (any case) other than `exceptId`. */
async function nameTaken(c: Client, eventId: number, name: string, exceptId: number) {
  const { rows } = await c.query(
    'SELECT 1 FROM waypoints WHERE event_id = $1 AND lower(name) = lower($2) AND id <> $3',
    [eventId, name, exceptId],
  );
  return rows.length > 0;
}

export async function addWaypoint(
  pool: Pool,
  eventId: number,
  w: WaypointInput,
): Promise<WaypointResult> {
  return withTransaction(pool, async (c) => {
    if (await nameTaken(c, eventId, w.name, 0)) return { ok: false, error: used(w.name) };
    const {
      rows: [row],
    } = await c.query<{ id: number }>(
      `INSERT INTO waypoints (event_id, name, lat, lon, alt, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [eventId, w.name, w.lat, w.lon, w.alt, w.description],
    );
    await bumpGroups(c, eventId);
    return { ok: true, id: row!.id } as const;
  });
}

/** False error "gone" when the waypoint is not the event's (any more). */
export async function updateWaypoint(
  pool: Pool,
  eventId: number,
  id: number,
  w: WaypointInput,
): Promise<WaypointResult> {
  return withTransaction(pool, async (c) => {
    if (await nameTaken(c, eventId, w.name, id)) return { ok: false, error: used(w.name) };
    const { rowCount } = await c.query(
      `UPDATE waypoints SET name = $3, lat = $4, lon = $5, alt = $6, description = $7
       WHERE id = $1 AND event_id = $2`,
      [id, eventId, w.name, w.lat, w.lon, w.alt, w.description],
    );
    if (!rowCount) return { ok: false, error: 'gone' };
    await bumpGroups(c, eventId);
    return { ok: true, id } as const;
  });
}

/** Refused while the task uses the waypoint (the legacy rule). */
export async function deleteWaypoint(
  pool: Pool,
  eventId: number,
  id: number,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  return withTransaction(pool, async (c) => {
    const {
      rows: [w],
    } = await c.query<{ name: string; in_task: boolean }>(
      `SELECT name, EXISTS (SELECT 1 FROM tasks t WHERE t.waypoint_id = waypoints.id) AS in_task
       FROM waypoints WHERE id = $1 AND event_id = $2 FOR UPDATE`,
      [id, eventId],
    );
    if (!w) return { ok: false, error: 'gone' };
    if (w.in_task)
      return {
        ok: false,
        error: `Cannot delete the waypoint '${w.name}' because it's used in the task`,
      };
    await c.query('DELETE FROM waypoints WHERE id = $1', [id]);
    await bumpGroups(c, eventId);
    return { ok: true, name: w.name } as const;
  });
}

/** Deletes every waypoint of the event, and with them its task. Returns how many there were. */
export async function deleteAllWaypoints(pool: Pool, eventId: number): Promise<number> {
  return withTransaction(pool, async (c) => {
    const { rowCount } = await c.query('DELETE FROM waypoints WHERE event_id = $1', [eventId]);
    if (rowCount) await bumpGroups(c, eventId);
    return rowCount ?? 0;
  });
}

export interface CoordPrefs {
  format: CoordFormat;
  /** Offered first in the hemisphere lists of the add form. */
  ns: 'N' | 'S';
  ew: 'E' | 'W';
}

export async function getCoordPrefs(pool: Pool, userId: string): Promise<CoordPrefs> {
  const { rows } = await pool.query<{ f: string; ns: string; ew: string }>(
    'SELECT coord_format AS f, def_hemisphere_ns AS ns, def_hemisphere_ew AS ew FROM user_profiles WHERE user_id = $1',
    [userId],
  );
  const r = rows[0];
  return {
    format: r && isCoordFormat(r.f) ? r.f : 'Deg',
    ns: r?.ns === 'S' ? 'S' : 'N',
    ew: r?.ew === 'W' ? 'W' : 'E',
  };
}

export async function saveCoordPrefs(
  pool: Pool,
  userId: string,
  p: Partial<CoordPrefs>,
): Promise<void> {
  const cur = await getCoordPrefs(pool, userId);
  const next = { ...cur, ...p };
  await pool.query(
    `INSERT INTO user_profiles (user_id, coord_format, def_hemisphere_ns, def_hemisphere_ew)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET coord_format = EXCLUDED.coord_format,
       def_hemisphere_ns = EXCLUDED.def_hemisphere_ns, def_hemisphere_ew = EXCLUDED.def_hemisphere_ew`,
    [userId, next.format, next.ns, next.ew],
  );
}
