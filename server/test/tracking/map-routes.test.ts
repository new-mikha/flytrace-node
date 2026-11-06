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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadConfig, type Config } from '../../src/config.ts';
import { createPool, type Pool } from '../../src/db.ts';

const USER = `__test_map_${Math.random().toString(36).slice(2, 8)}`;
const NO_GROUP = 2147483000;

let app: FastifyInstance;
let pool: Pool;
let group: number;

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
  const created = await pool.query<{ id: number }>(
    `INSERT INTO groups (name, user_id) VALUES ('Map test', $1) RETURNING id`,
    [user.rows[0]!.id],
  );
  group = created.rows[0]!.id;
  await pool.query(
    `INSERT INTO group_trackers (group_id, name, tracker_type, foreign_id, is_on) VALUES
       ($1, 'Anna', 'S', 'test-feed-of-twenty-chars-1', true),
       ($1, 'Boris', 'G', 'share.garmin.com/Feed/Share/test#1', false)`,
    [group],
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
