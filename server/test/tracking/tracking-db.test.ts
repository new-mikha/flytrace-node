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

// `feed_polls` for real, against the dev database: the other tests stand in for the pool, so they
// never run this SQL. The source is fake, with a gap of 1 ms: no fake clock needed, nothing waits.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { createPool, type Pool } from '../../src/db.ts';
import { sources } from '../../src/tracking/sources/index.ts';
import type { TrackerSource } from '../../src/tracking/sources/types.ts';
import { Tracking } from '../../src/tracking/tracking.ts';
import { fakeLog } from './helpers.ts';

const FEED = `__test_feed_${Math.random().toString(36).slice(2, 8)}`;
const INTERVAL = 3600_000;
const real = sources.S;

let pool: Pool;
let tracking: Tracking | undefined;

const polledAt = async () => {
  const { rows } = await pool.query<{ last_polled_at: Date }>(
    `SELECT last_polled_at FROM feed_polls WHERE tracker_type = 'S' AND foreign_id = $1`,
    [FEED],
  );
  return rows[0]?.last_polled_at.getTime();
};

const remember = (ago: string) =>
  pool.query(
    `INSERT INTO feed_polls (tracker_type, foreign_id, last_polled_at)
     VALUES ('S', $1, now() - $2::interval)`,
    [FEED, ago],
  );

async function started(feedIntervalMs = INTERVAL) {
  const source: TrackerSource = {
    ...real,
    rules: { startGapMs: 1, maxInFlight: 1, feedIntervalMs, callTimeoutMs: 100 },
    poll: () => Promise.resolve({ points: [], error: null, requestCount: 1 }),
  };
  sources.S = source;
  tracking = new Tracking(pool, fakeLog().log);
  await tracking.start();
  return tracking;
}

beforeAll(() => {
  pool = createPool(loadConfig().DATABASE_URL);
});

afterEach(async () => {
  tracking?.stop();
  sources.S = real;
  await pool.query('DELETE FROM feed_polls WHERE foreign_id = $1', [FEED]);
});

afterAll(async () => {
  await pool.end();
});

describe('feed_polls', () => {
  it('gets a row at the start of a call', async () => {
    const before = Date.now();
    const tracking = await started();
    tracking.access([{ type: 'S', feedId: FEED }]);

    await vi.waitFor(async () => expect(await polledAt()).toBeDefined());
    expect(await polledAt()).toBeGreaterThanOrEqual(before);
    expect(await polledAt()).toBeLessThanOrEqual(Date.now());
  });

  it('moves the time of a feed it already knows', async () => {
    await remember('30 minutes');
    const old = await polledAt();
    const tracking = await started(1000);
    tracking.access([{ type: 'S', feedId: FEED }]);

    await vi.waitFor(async () => expect(await polledAt()).toBeGreaterThan(old!));
  });

  it('holds a feed back after a restart until its interval is over', async () => {
    await remember('10 minutes');
    const tracking = await started();
    const [tracker] = tracking.access([{ type: 'S', feedId: FEED }]);
    expect(tracker!.dueAt).toBe((await polledAt())! + INTERVAL);
  });

  it('keeps a row younger than an hour at the start', async () => {
    await remember('59 minutes');
    await started();
    expect(await polledAt()).toBeDefined();
  });

  it('loses a row older than an hour at the start', async () => {
    await remember('61 minutes');
    await started();
    expect(await polledAt()).toBeUndefined();
  });
});
