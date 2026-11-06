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

// The shared map of trackers, on a fake clock, with fake sources and a stand-in for the pool.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '../../src/db.ts';
import { sources } from '../../src/tracking/sources/index.ts';
import type { FeedResult, SourceType, TrackerSource } from '../../src/tracking/sources/types.ts';
import { Tracking } from '../../src/tracking/tracking.ts';
import { fakeLog } from './helpers.ts';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const MINUTE = 60_000;
const DONE: FeedResult = { points: [], error: null, requestCount: 1 };
const real = { ...sources };

function fakeSource(type: SourceType, feedIntervalMs: number): TrackerSource {
  return {
    type,
    name: type,
    rules: { startGapMs: 2000, maxInFlight: 10, feedIntervalMs, callTimeoutMs: 20_000 },
    poll: vi.fn(() => Promise.resolve(DONE)),
    parseFeedId: () => ({ error: 'unused' }),
    checkFeed: () => Promise.resolve({ error: 'unused' }),
  };
}

interface PollRow {
  tracker_type: SourceType;
  foreign_id: string;
  last_polled_at: Date;
}

function stubPool(rows: PollRow[] = []) {
  const query = vi.fn((sql: string, _params?: unknown[]) =>
    Promise.resolve({ rows: sql.startsWith('SELECT') ? rows : [] }),
  );
  return { query, pool: { query } as unknown as Pool };
}

const pollsOf = (type: SourceType) => sources[type].poll as ReturnType<typeof vi.fn>;
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const spot = (feedId: string) => ({ type: 'S' as const, feedId });
const garmin = (feedId: string) => ({ type: 'G' as const, feedId });

let tracking: Tracking | undefined;

async function started(rows: PollRow[] = []) {
  const { query, pool } = stubPool(rows);
  const { lines, log } = fakeLog();
  tracking = new Tracking(pool, log);
  await tracking.start();
  return { tracking, query, lines };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  sources.S = fakeSource('S', 150_000);
  sources.G = fakeSource('G', 30_000);
});

afterEach(() => {
  tracking?.stop();
  tracking = undefined;
  Object.assign(sources, real);
  vi.useRealTimers();
});

describe('before start', () => {
  it('answers with throwaway trackers that never get polled', async () => {
    const { pool } = stubPool();
    tracking = new Tracking(pool, fakeLog().log);

    const [first] = tracking.access([spot('a')]);
    const [second] = tracking.access([spot('a')]);
    expect(first!.answered).toBe(false);
    expect(first).not.toBe(second);

    await pass(10 * MINUTE);
    expect(pollsOf('S')).not.toHaveBeenCalled();
  });

  it('touches no database', () => {
    const { pool, query } = stubPool();
    tracking = new Tracking(pool, fakeLog().log);
    tracking.access([spot('a')]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('start', () => {
  it('clears old rows of feed_polls first, and then reads the rest', async () => {
    const { query } = await started();
    const statements = query.mock.calls.map(([sql]) => sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^DELETE FROM feed_polls WHERE last_polled_at < now\(\)/);
    expect(statements[0]).toContain("interval '1 hour'");
    expect(statements[1]).toMatch(/^SELECT .* FROM feed_polls$/);
  });
});

describe('access', () => {
  it('gives the trackers in the order of the feeds, a new one answering "wait"', async () => {
    const { tracking } = await started();
    const trackers = tracking.access([spot('a'), garmin('b'), spot('c')]);

    expect(trackers.map((t) => t.feedId)).toEqual(['a', 'b', 'c']);
    expect(trackers.every((t) => !t.answered)).toBe(true);
  });

  it('keeps one tracker per feed, polled once for all the groups showing it', async () => {
    const { tracking } = await started();
    const [first] = tracking.access([spot('a')]);
    const [second] = tracking.access([spot('a')]);
    const [third, fourth] = tracking.access([spot('a'), spot('a')]);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fourth).toBe(first);

    await pass(2000);
    expect(pollsOf('S')).toHaveBeenCalledOnce();
  });

  it('tells feeds of the two sources apart, even with one id', async () => {
    const { tracking } = await started();
    const [one, other] = tracking.access([spot('same'), garmin('same')]);

    expect(one).not.toBe(other);
    expect(one!.key).toBe('S:same');
    expect(other!.key).toBe('G:same');
  });

  it('sends each feed to its own source, side by side', async () => {
    const { tracking } = await started();
    tracking.access([spot('a'), garmin('b')]);

    await pass(2000);
    expect(pollsOf('S').mock.calls[0]![0]).toBe('a');
    expect(pollsOf('G').mock.calls[0]![0]).toBe('b');
  });

  it('polls a feed at the rate of its source', async () => {
    const { tracking } = await started();
    tracking.access([spot('a'), garmin('b')]);

    await pass(5 * MINUTE);
    expect(pollsOf('G').mock.calls.length).toBeGreaterThan(7);
    expect(pollsOf('S').mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('the lifetime of a tracker', () => {
  it('lasts as long as somebody keeps asking', async () => {
    const { tracking } = await started();
    const [first] = tracking.access([spot('a')]);

    for (let i = 0; i < 6; i++) {
      await pass(15 * MINUTE);
      expect(tracking.access([spot('a')])[0]).toBe(first);
    }
  });

  it('ends 20 minutes after the last request, and so does the polling', async () => {
    const { tracking } = await started();
    const [first] = tracking.access([garmin('a')]);

    await pass(20 * MINUTE);
    expect(first!.removed).toBe(true);
    const polls = pollsOf('G').mock.calls.length;

    await pass(20 * MINUTE);
    expect(pollsOf('G').mock.calls.length).toBe(polls);
  });

  it('starts again from "wait" when somebody asks later', async () => {
    const { tracking } = await started();
    const [first] = tracking.access([garmin('a')]);
    await pass(21 * MINUTE);

    const [second] = tracking.access([garmin('a')]);
    expect(second).not.toBe(first);
    expect(second!.track).toBeNull();
  });

  it('still keeps the feed interval when somebody asks right after the removal', async () => {
    const { tracking } = await started();
    tracking.access([spot('a')]);
    await pass(20 * MINUTE);
    const polls = pollsOf('S').mock.calls.length;

    tracking.access([spot('a')]);
    await pass(2000);
    expect(pollsOf('S').mock.calls.length).toBe(polls);
  });
});

describe('after a restart', () => {
  const row = (agoMs: number): PollRow => ({
    tracker_type: 'S',
    foreign_id: 'a',
    last_polled_at: new Date(NOW - agoMs),
  });

  it('does not hit a feed before its interval is over', async () => {
    const { tracking } = await started([row(MINUTE)]);
    tracking.access([spot('a')]);

    await pass(89_000);
    expect(pollsOf('S')).not.toHaveBeenCalled();

    await pass(3000);
    expect(pollsOf('S')).toHaveBeenCalledOnce();
  });

  it('polls right away when the interval is over', async () => {
    const { tracking } = await started([row(151_000)]);
    tracking.access([spot('a')]);

    await pass(2000);
    expect(pollsOf('S')).toHaveBeenCalledOnce();
  });

  it('goes by type and id: another feed is not held back', async () => {
    const { tracking } = await started([row(MINUTE)]);
    tracking.access([garmin('a'), spot('b')]);

    await pass(2000);
    expect(pollsOf('G')).toHaveBeenCalledOnce();
    expect(pollsOf('S')).toHaveBeenCalledOnce();
  });
});

describe('feed_polls', () => {
  it('is written as a call starts', async () => {
    const { tracking, query } = await started();
    tracking.access([spot('a')]);
    await pass(2000);

    const [sql, params] = query.mock.calls.at(-1)!;
    expect(sql).toContain('INSERT INTO feed_polls');
    expect(sql).toContain('ON CONFLICT (tracker_type, foreign_id) DO UPDATE');
    expect(params).toEqual(['S', 'a', NOW + 2000]);
  });

  it('holds up nothing when the write fails: a WARN, not an ERROR', async () => {
    const { tracking, query, lines } = await started();
    query.mockRejectedValue(new Error('database down'));
    tracking.access([garmin('a')]);

    await pass(2000 + 32_000);
    expect(pollsOf('G')).toHaveBeenCalledTimes(2);
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'Could not save the time of a poll' }),
    );
  });
});

describe('stop', () => {
  it('ends the polling and the calls in flight', async () => {
    const { tracking } = await started();
    let signal: AbortSignal | undefined;
    pollsOf('G').mockImplementation((_feed: string, _held: unknown, callSignal: AbortSignal) => {
      signal = callSignal;
      return new Promise(() => {});
    });
    tracking.access([garmin('a')]);
    await pass(2000);

    tracking.stop();
    expect(signal?.aborted).toBe(true);

    await pass(MINUTE);
    expect(pollsOf('G')).toHaveBeenCalledOnce();
  });

  it('leaves later requests with a "wait"', async () => {
    const { tracking } = await started();
    tracking.stop();

    const [first] = tracking.access([garmin('new')]);
    const [second] = tracking.access([garmin('new')]);
    expect(first).not.toBe(second);

    await pass(MINUTE);
    expect(pollsOf('G')).not.toHaveBeenCalled();
  });
});
