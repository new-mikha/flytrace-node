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

// The admin's list of trackers held in memory: who may see it, and what a row says.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import { trackerRows } from '../src/repo/adminTrackers.ts';
import { Tracker } from '../src/tracking/tracker.ts';
import { point } from './tracking/helpers.ts';

const run = Math.random().toString(36).slice(2, 8);
const ADMIN = `__test_trk_a_${run}`;
const PLAIN = `__test_trk_p_${run}`;
const PASSWORD = 'correct horse';
const FEED = `__test_feed_${run}`;
const form = { 'content-type': 'application/x-www-form-urlencoded' };

let app: FastifyInstance;
let pool: Pool;

async function login(username: string, remoteAddress: string): Promise<Record<string, string>> {
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    remoteAddress,
    headers: form,
    payload: new URLSearchParams({ username, password: PASSWORD }).toString(),
  });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid')!;
  return { [cookie.name]: cookie.value };
}

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  app = await buildApp(config, pool);
  for (const name of [ADMIN, PLAIN]) {
    const {
      rows: [u],
    } = await pool.query<{ id: number }>(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [name, await hashPassword(PASSWORD)],
    );
    if (name === ADMIN)
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'Admins'`,
        [u!.id],
      );
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = ANY($1)', [[ADMIN, PLAIN]]);
  await app.close();
});

describe('/admin/trackers', () => {
  it('is for admins only', async () => {
    expect(
      (await app.inject({ url: '/admin/trackers', remoteAddress: '10.78.0.1' })).statusCode,
    ).not.toBe(200);
    const cookies = await login(PLAIN, '10.78.0.2');
    const res = await app.inject({ url: '/admin/trackers', remoteAddress: '10.78.0.2', cookies });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/403');
  });

  it('says so when no tracker is held', async () => {
    const cookies = await login(ADMIN, '10.78.0.3');
    const res = await app.inject({ url: '/admin/trackers', remoteAddress: '10.78.0.3', cookies });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Trackers in memory (0)');
    expect(res.body).toContain('No tracker is held');
  });

  it('lists a tracker a map asked for, waiting', async () => {
    // Polling is not started in tests, so the map holds nothing; a started one would call the feed:
    vi.spyOn(app.tracking, 'list').mockReturnValue([new Tracker(`S:${FEED}`, FEED, () => {})]);
    const cookies = await login(ADMIN, '10.78.0.4');
    const res = await app.inject({ url: '/admin/trackers', remoteAddress: '10.78.0.4', cookies });

    expect(res.body).toContain('Trackers in memory (1)');
    expect(res.body).toContain(`S:${FEED}`);
    expect(res.body).toContain('Waiting');
    vi.restoreAllMocks();
  });

  it('is linked from the users list', async () => {
    const cookies = await login(ADMIN, '10.78.0.5');
    const res = await app.inject({ url: '/admin', remoteAddress: '10.78.0.5', cookies });
    expect(res.body).toContain('href="/admin/trackers"');
  });
});

describe('trackerRows', () => {
  const NOW = Date.parse('2026-01-10T12:00:00Z');

  function tracker(key: string, accessedAt: number): Tracker {
    const t = new Tracker(key, key.slice(2), () => {});
    t.accessedAt = accessedAt;
    return t;
  }

  it('puts the newest request first, then the key', () => {
    const rows = trackerRows([
      tracker('S:b', NOW - 5000),
      tracker('G:a', NOW),
      tracker('S:a', NOW - 5000),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['G:a', 'S:a', 'S:b']);
  });

  it('names the source, and tells waiting, calling and idle apart', () => {
    const waiting = tracker('S:a', NOW);
    const calling = tracker('G:b', NOW - 1);
    calling.answered = true;
    calling.inFlight = true;
    const idle = tracker('S:c', NOW - 2);
    idle.answered = true;
    // The first call is running and has not answered yet: it is calling, not just waiting:
    const first = tracker('S:d', NOW - 3);
    first.inFlight = true;

    const rows = trackerRows([waiting, calling, idle, first]);
    expect(rows.map((r) => [r.key, r.source, r.state])).toEqual([
      ['S:a', 'SPOT', 'waiting'],
      ['G:b', 'inReach', 'calling'],
      ['S:c', 'SPOT', 'idle'],
      ['S:d', 'SPOT', 'calling'],
    ]);
  });

  it('carries the points, the error, the length of the track and the times', () => {
    const t = tracker('S:a', NOW);
    t.applyResult({
      points: [point('1', NOW - 60_000, { lat: 1.5, lon: 2.5 }), point('2', NOW - 120_000)],
      error: null,
      requestCount: 1,
    });
    // A later call failed: the position held stays, with the error beside it:
    t.applyResult({
      points: [],
      error: { kind: 'timeout', userMessage: 'Too slow', status: 504 },
      requestCount: 1,
    });
    t.refreshedAt = NOW + 1;

    const [row] = trackerRows([t]);
    expect(row).toMatchObject({
      latest: { lat: 1.5, lon: 2.5, ts: new Date(NOW - 60_000) },
      error: { kind: 'timeout', message: 'Too slow', status: 504 },
      trackPoints: 2,
      refreshedAt: new Date(NOW + 1),
    });
    expect(row!.previous?.ts).toEqual(new Date(NOW - 120_000));
  });

  it('shows nothing for what a tracker has not got yet', () => {
    const [row] = trackerRows([tracker('S:a', NOW)]);
    expect(row).toMatchObject({
      latest: null,
      previous: null,
      error: null,
      trackPoints: null,
      refreshedAt: null,
    });
  });
});
