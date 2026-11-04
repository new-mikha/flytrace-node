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
import type { SourceType } from '../tracking/sources/types.ts';

export interface MapGroup {
  id: number;
  name: string;
}

/** The group whose map is asked for, or null when there is no such group. */
export async function getMapGroup(pool: Pool, id: number): Promise<MapGroup | null> {
  // An id past the range of `integer` is no group, and must not reach the query as an error:
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) return null;
  const { rows } = await pool.query<MapGroup>('SELECT id, name FROM groups WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export interface MapViewTracker {
  name: string;
  type: SourceType;
  feedId: string;
  isOn: boolean;
}

/** What the map's two requests need to know about a group. */
export interface MapView {
  showMessages: boolean;
  /** The owner's choice; null: the map shows no altitude. */
  altitudeUnits: string | null;
  /** The event's "hide old points". */
  startTs: Date | null;
  trackers: MapViewTracker[];
}

export async function getMapView(pool: Pool, id: number): Promise<MapView | null> {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) return null;
  const [group, trackers] = await Promise.all([
    pool.query<{
      display_user_messages: boolean;
      altitude_unit: string | null;
      start_ts: Date | null;
    }>(
      `SELECT g.display_user_messages, p.altitude_unit, e.start_ts
       FROM groups g
       LEFT JOIN user_profiles p ON p.user_id = g.user_id
       LEFT JOIN events e ON e.id = g.event_id
       WHERE g.id = $1`,
      [id],
    ),
    pool.query<{ name: string; tracker_type: SourceType; foreign_id: string; is_on: boolean }>(
      `SELECT name, tracker_type, foreign_id, is_on FROM group_trackers WHERE group_id = $1
        ORDER BY id`,
      [id],
    ),
  ]);
  const g = group.rows[0];
  if (!g) return null;
  return {
    showMessages: g.display_user_messages,
    altitudeUnits: g.altitude_unit,
    startTs: g.start_ts,
    trackers: trackers.rows.map((t) => ({
      name: t.name,
      type: t.tracker_type,
      feedId: t.foreign_id,
      isOn: t.is_on,
    })),
  };
}
