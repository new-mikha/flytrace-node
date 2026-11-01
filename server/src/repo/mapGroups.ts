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
