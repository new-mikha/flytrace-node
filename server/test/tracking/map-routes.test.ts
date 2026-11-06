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

// The map's two requests over HTTP, against the dev database. `buildApp` alone never polls, so every
// tracker answers "wait": what a feed returns is tested in the other files of this folder.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadConfig, type Config } from '../../src/config.ts';
import { createPool, type Pool } from '../../src/db.ts';
import { sources } from '../../src/tracking/sources/index.ts';
import type { TrackerSource } from '../../src/tracking/sources/types.ts';

const USER = `__test_map_${Math.random().toString(36).slice(2, 8)}`;
const NO_GROUP = 2147483000;
const FEEDS = ['test-feed-of-twenty-chars-1', 'share.garmin.com/Feed/Share/test#1'];

let app: FastifyInstance;
let pool: Pool;
let group: number;
let userId: string;

const postTracks = (id: number | string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: `/map/${id}/tracks`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });

beforeAll(async () => {
  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);
  app = await buildApp(config, pool);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`,
    [USER],
  );
  userId = user.rows[0]!.id;
  const created = await pool.query<{ id: number }>(
    `INSERT INTO groups (name, user_id) VALUES ('Map test', $1) RETURNING id`,
    [userId],
  );
  group = created.rows[0]!.id;
  await pool.query(
    `INSERT INTO group_trackers (group_id, name, tracker_type, foreign_id, is_on) VALUES
       ($1, 'Anna', 'S', $2, true),
       ($1, 'Boris', 'G', $3, false)`,
    [group, ...FEEDS],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [USER]);
  await app.close();
});

describe('GET /map/:id', () => {
  it('shows the map of a group, to anybody', async () => {
    const res = await app.inject({ url: `/map/${group}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Map test');
  });

  // The last two pass as digits, but are past what the column holds:
  it.each([String(NO_GROUP), 'abc', '0', '99999999999', '9999999999', '2147483648'])(
    'goes home for %s',
    async (id) => {
      const res = await app.inject({ url: `/map/${id}` });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/');
    },
  );

  describe('the task', () => {
    const taskOf = async (id: number) => {
      const res = await app.inject({ url: `/map/${id}` });
      return /var _task = (.*);/.exec(res.body)![1]!;
    };

    const eventWith = async (waypoints: [string, number, number, number, number][]) => {
      const event = await pool.query<{ id: number }>(
        `INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id`,
        [userId, `Event ${Math.random()}`],
      );
      const eventId = event.rows[0]!.id;
      for (const [name, lat, lon, radius, order] of waypoints) {
        const waypoint = await pool.query<{ id: number }>(
          `INSERT INTO waypoints (event_id, name, lat, lon, alt) VALUES ($1, $2, $3, $4, 0)
           RETURNING id`,
          [eventId, name, lat, lon],
        );
        await pool.query('INSERT INTO tasks (waypoint_id, radius, wpt_order) VALUES ($1, $2, $3)', [
          waypoint.rows[0]!.id,
          radius,
          order,
        ]);
      }
      return eventId;
    };

    const groupOf = async (eventId: number | null) => {
      const created = await pool.query<{ id: number }>(
        `INSERT INTO groups (name, user_id, event_id) VALUES ($1, $2, $3) RETURNING id`,
        [`Task test ${Math.random()}`, userId, eventId],
      );
      return created.rows[0]!.id;
    };

    it('is empty for a group with no event', async () => {
      expect(await taskOf(group)).toBe('[]');
    });

    it('is empty for an event with no task', async () => {
      expect(await taskOf(await groupOf(await eventWith([])))).toBe('[]');
    });

    it('lists the waypoints in the order of the task, not of the rows', async () => {
      const eventId = await eventWith([
        ['Goal', -26.06966, 150.5, 2000, 1],
        ['Start', -26.5, 151, 400, 0],
      ]);
      expect(JSON.parse(await taskOf(await groupOf(eventId)))).toEqual([
        'Start',
        -26.5,
        151,
        400,
        'Goal',
        -26.06966,
        150.5,
        2000,
      ]);
    });

    it('holds only the task of the event of this group', async () => {
      await eventWith([['Other', 1, 2, 3, 0]]);
      expect(await taskOf(await groupOf(await eventWith([['Mine', 4, 5, 6, 0]])))).toContain(
        'Mine',
      );
    });

    it('is safe in the script, whatever the names', async () => {
      const name = `O'Brien "</script><b>`;
      const res = await app.inject({
        url: `/map/${await groupOf(await eventWith([[name, 1, 2, 3, 0]]))}`,
      });

      expect(res.body).not.toContain('</script><b>');
      const task = /var _task = (.*);/.exec(res.body)![1]!;
      expect(JSON.parse(task)[0]).toBe(name);
    });

    it('keeps a name on one line', async () => {
      const eventId = await eventWith([[' Two\r\nlines\nhere ', 1, 2, 3, 0]]);
      expect(JSON.parse(await taskOf(await groupOf(eventId)))[0]).toBe('Two lines here');
    });
  });

  describe('the Map ID', () => {
    const pageWith = async (more: Partial<Config>) => {
      const config = loadConfig();
      // Its own pool: closing an app ends the pool it was given.
      const other = await buildApp({ ...config, ...more }, createPool(config.DATABASE_URL));
      const res = await other.inject({ url: `/map/${group}` });
      await other.close();
      return res.body;
    };

    it("falls back on Google's demo id outside production", async () => {
      const body = await pageWith({ GOOGLE_MAPS_MAP_ID: undefined, NODE_ENV: 'development' });
      expect(body).toContain('DEMO_MAP_ID');
    });

    it('never does in production', async () => {
      const body = await pageWith({ GOOGLE_MAPS_MAP_ID: undefined, NODE_ENV: 'production' });
      expect(body).not.toContain('DEMO_MAP_ID');
    });

    it('is the configured one when there is one', async () => {
      const body = await pageWith({ GOOGLE_MAPS_MAP_ID: 'test-map-id', NODE_ENV: 'development' });
      expect(body).toContain('test-map-id');
      expect(body).not.toContain('DEMO_MAP_ID');
    });
  });
});

describe('GET /map/:id/coordinates', () => {
  it('answers at once with the whole group, in order', async () => {
    const res = await app.inject({ url: `/map/${group}/coordinates` });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      trackers: [
        { name: 'Anna', type: 'wait' },
        { name: 'Boris', type: 'wait', hidden: true },
      ],
      ver: expect.any(Number),
    });
  });

  it.each([String(NO_GROUP), 'abc', '9999999999', '2147483648'])(
    'refuses the group %s',
    async (id) => {
      const res = await app.inject({ url: `/map/${id}/coordinates` });
      expect(res.statusCode).toBe(404);
    },
  );
});

describe('the statistics of a group', () => {
  const stats = async () => {
    const { rows } = await pool.query<{
      updates: string;
      ts: Date | null;
      lat: number | null;
      lon: number | null;
    }>(
      `SELECT page_updates_num AS updates, newest_coord_ts AS ts, newest_lat AS lat, newest_lon AS lon
       FROM groups WHERE id = $1`,
      [group],
    );
    return rows[0]!;
  };

  const feedOf = (source: TrackerSource, time: string, lat: number): TrackerSource => ({
    ...source,
    rules: { ...source.rules, startGapMs: 1 },
    poll: () =>
      Promise.resolve({
        points: [{ id: '1', lat, lon: lat + 1, ts: new Date(time), type: 'TRACK' }],
        error: null,
        requestCount: 1,
      }),
  });

  it('counts an answer and keeps the position while there is none', async () => {
    await pool.query(
      `UPDATE groups SET newest_coord_ts = '2020-01-01Z', newest_lat = 5, newest_lon = 6 WHERE id = $1`,
      [group],
    );
    const before = Number((await stats()).updates);
    await app.inject({ url: `/map/${group}/coordinates` });

    await vi.waitFor(async () => expect(Number((await stats()).updates)).toBe(before + 1));
    expect(await stats()).toMatchObject({ ts: new Date('2020-01-01Z'), lat: 5, lon: 6 });
  });

  it('takes the newest position of the answer, and the home page goes by it', async () => {
    const real = { ...sources };
    sources.S = feedOf(real.S, '2026-01-10T10:00:00Z', 10);
    sources.G = feedOf(real.G, '2026-01-10T11:00:00Z', 20);
    const config = loadConfig();
    const polling = await buildApp(config, createPool(config.DATABASE_URL));
    await polling.tracking.start();
    try {
      await vi.waitFor(async () => {
        await polling.inject({ url: `/map/${group}/coordinates` });
        expect(await stats()).toMatchObject({
          ts: new Date('2026-01-10T11:00:00Z'),
          lat: 20,
          lon: 21,
        });
      });
    } finally {
      await polling.close();
      Object.assign(sources, real);
      await pool.query('DELETE FROM feed_polls WHERE foreign_id = ANY($1)', [FEEDS]);
    }
  });

  it('is not touched by the tracks', async () => {
    const before = (await stats()).updates;
    await postTracks(group, { items: [{ trackerName: 'Anna' }] });
    await app.inject({ url: `/map/${group}` });
    expect((await stats()).updates).toBe(before);
  });
});

describe('POST /map/:id/tracks', () => {
  it('answers with no tracks while the feeds have none', async () => {
    const res = await postTracks(group, { items: [{ trackerName: 'Anna' }] });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual([]);
  });

  it('ignores a name that is not in the group', async () => {
    const res = await postTracks(group, { items: [{ trackerName: 'Nobody' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('takes up to 10 items', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ trackerName: `N${i}` }));
    expect((await postTracks(group, { items })).statusCode).toBe(200);
  });

  it.each([
    ['no items', {}],
    ['items that are no list', { items: 'Anna' }],
    ['more than 10 items', { items: Array(11).fill({ trackerName: 'Anna' }) }],
    ['an item without a name', { items: [{}] }],
    ['an empty name', { items: [{ trackerName: '' }] }],
    ['a name that is no text', { items: [{ trackerName: 5 }] }],
    ['a null item', { items: [null] }],
  ])('refuses %s', async (_, payload) => {
    expect((await postTracks(group, payload)).statusCode).toBe(400);
  });

  it('refuses a group that does not exist', async () => {
    const res = await postTracks(NO_GROUP, { items: [{ trackerName: 'Anna' }] });
    expect(res.statusCode).toBe(404);
  });
});
