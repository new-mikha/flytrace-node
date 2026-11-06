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

// What "Download my data" holds about events: the waypoints and the task go with them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportPersonalData } from '../src/auth/accounts.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const USER = `__test_data_${Math.random().toString(36).slice(2, 8)}`;

interface ExportedEvent {
  name: string;
  waypoints: { name: string; lat: number; description: string | null }[];
  task: { waypoint: string; radius: number }[];
}

let pool: Pool;
let userId: string;

const eventsOf = async () =>
  ((await exportPersonalData(pool, userId)) as { events: ExportedEvent[] }).events;

beforeAll(async () => {
  pool = createPool(loadConfig().DATABASE_URL);
  const {
    rows: [u],
  } = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`,
    [USER],
  );
  userId = u!.id;

  const add = async (name: string) =>
    (
      await pool.query<{ id: number }>(
        'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
        [userId, name],
      )
    ).rows[0]!.id;
  const full = await add('Full');
  await add('Empty');

  const wpt = async (name: string, lat: number) =>
    (
      await pool.query<{ id: number }>(
        `INSERT INTO waypoints (event_id, name, lat, lon, alt, description)
         VALUES ($1, $2, $3, 150, 100, 'Note') RETURNING id`,
        [full, name, lat],
      )
    ).rows[0]!.id;
  const first = await wpt('A', -30);
  const second = await wpt('B', -31);
  // Stored against the order, and one waypoint twice: a task may go back to a point.
  await pool.query(
    `INSERT INTO tasks (waypoint_id, radius, wpt_order)
     VALUES ($1, 400, 2), ($2, 1000, 1), ($2, 2000, 3)`,
    [first, second],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

describe('the export of an event', () => {
  it('holds its waypoints', async () => {
    const [full] = await eventsOf();
    expect(full!.waypoints.map((w) => [w.name, w.lat, w.description])).toEqual([
      ['A', -30, 'Note'],
      ['B', -31, 'Note'],
    ]);
  });

  it('holds its task, in the order of the task', async () => {
    const [full] = await eventsOf();
    expect(full!.task).toEqual([
      { waypoint: 'B', radius: 1000 },
      { waypoint: 'A', radius: 400 },
      { waypoint: 'B', radius: 2000 },
    ]);
  });

  it('gives empty lists for an event with neither', async () => {
    const [, empty] = await eventsOf();
    expect(empty).toMatchObject({ name: 'Empty', waypoints: [], task: [] });
  });
});
