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

// One source's timeline, on a fake clock: nothing here waits for real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pipeline } from '../../src/tracking/pipeline.ts';
import type { FeedResult, TrackerSource } from '../../src/tracking/sources/types.ts';
import { Tracker } from '../../src/tracking/tracker.ts';
import { deferred, fakeLog, point } from './helpers.ts';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const DONE: FeedResult = { points: [], error: null, requestCount: 1 };

const tracker = (name: string) => new Tracker(`G:${name}`, name, () => {});

function setUp(rules: Partial<TrackerSource['rules']> = {}) {
  const poll = vi.fn<TrackerSource['poll']>(() => Promise.resolve(DONE));
  const source: TrackerSource = {
    type: 'G',
    name: 'inReach',
    rules: {
      startGapMs: 2000,
      maxInFlight: 10,
      feedIntervalMs: 30_000,
      callTimeoutMs: 25_000,
      ...rules,
    },
    poll,
    parseFeedId: () => ({ error: 'unused' }),
  };
  const { lines, log } = fakeLog();
  const shutdown = new AbortController();
  const onCallStart = vi.fn();
  const pipeline = new Pipeline(source, log, shutdown.signal, onCallStart);
  pipeline.start();
  return { poll, lines, shutdown, onCallStart, pipeline };
}

const polled = (poll: ReturnType<typeof setUp>['poll']) => poll.mock.calls.map((call) => call[0]);
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the rules of a source', () => {
  it('refuses a call that may last as long as the feed interval', () => {
    expect(() => setUp({ callTimeoutMs: 30_000, feedIntervalMs: 30_000 })).toThrow(
      'inReach: a call may not last as long as the feed interval',
    );
  });
});

describe('starting calls', () => {
  it('starts nothing before the first tick', async () => {
    const { poll, pipeline } = setUp();
    pipeline.add([tracker('a')]);
    await pass(1999);
    expect(poll).not.toHaveBeenCalled();
  });

  it('starts one call per tick, in the order of the queue', async () => {
    const { poll, pipeline } = setUp();
    pipeline.add([tracker('a'), tracker('b'), tracker('c')]);

    await pass(2000);
    expect(polled(poll)).toEqual(['a']);
    await pass(2000);
    expect(polled(poll)).toEqual(['a', 'b']);
    await pass(2000);
    expect(polled(poll)).toEqual(['a', 'b', 'c']);
  });

  it('goes by the gap of the source', async () => {
    const { poll, pipeline } = setUp({ startGapMs: 500 });
    pipeline.add([tracker('a'), tracker('b')]);
    await pass(1000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('puts new arrivals behind those already waiting', async () => {
    const { poll, pipeline } = setUp();
    pipeline.add([tracker('a'), tracker('b')]);
    pipeline.add([tracker('c')]);
    await pass(6000);
    expect(polled(poll)).toEqual(['a', 'b', 'c']);
  });

  it('sorts the arrivals of one request by when they were due', async () => {
    const { poll, pipeline } = setUp();
    const late = tracker('late');
    late.dueAt = NOW - 1000;
    const early = tracker('early');
    early.dueAt = NOW - 5000;
    pipeline.add([late, early]);

    await pass(4000);
    expect(polled(poll)).toEqual(['early', 'late']);
  });

  it('holds back a tracker that is not due, and does not hold up the others', async () => {
    const { poll, pipeline } = setUp();
    const notYet = tracker('not-yet');
    notYet.dueAt = NOW + 10_000;
    pipeline.add([notYet, tracker('due')]);

    await pass(9999);
    expect(polled(poll)).toEqual(['due']);
    await pass(2001);
    expect(polled(poll)).toEqual(['due', 'not-yet']);
  });

  it('notes the start of a call, with the time, before the request', async () => {
    const { poll, pipeline, onCallStart } = setUp();
    const a = tracker('a');
    poll.mockImplementation(() => {
      expect(onCallStart).toHaveBeenCalledWith(a, NOW + 2000);
      return Promise.resolve(DONE);
    });
    pipeline.add([a]);
    await pass(2000);
    expect(poll).toHaveBeenCalledOnce();
  });

  it('marks the tracker as in flight for the length of the call', async () => {
    const { poll, pipeline } = setUp();
    const call = deferred<FeedResult>();
    poll.mockReturnValue(call.promise);
    const a = tracker('a');
    pipeline.add([a]);

    await pass(2000);
    expect(a.inFlight).toBe(true);
    call.resolve(DONE);
    await pass(0);
    expect(a.inFlight).toBe(false);
  });
});

describe('the limit of calls in flight', () => {
  it('waits for a free slot, and then goes on', async () => {
    const { poll, pipeline } = setUp({ maxInFlight: 2 });
    const calls = [deferred<FeedResult>(), deferred<FeedResult>(), deferred<FeedResult>()];
    calls.forEach((call) => poll.mockReturnValueOnce(call.promise));
    pipeline.add([tracker('a'), tracker('b'), tracker('c')]);

    await pass(20_000);
    expect(polled(poll)).toEqual(['a', 'b']);

    calls[0]!.resolve(DONE);
    await pass(2000);
    expect(polled(poll)).toEqual(['a', 'b', 'c']);
  });

  it('frees the slot of a call that failed or threw', async () => {
    const { poll, pipeline } = setUp({ maxInFlight: 1 });
    poll.mockRejectedValueOnce(new Error('bug'));
    poll.mockResolvedValueOnce({ ...DONE, error: { kind: 'timeout', userMessage: 'x' } });
    pipeline.add([tracker('a'), tracker('b'), tracker('c')]);

    await pass(6000);
    expect(polled(poll)).toEqual(['a', 'b', 'c']);
  });

  it('is shared by all the feeds, ten at most by default', async () => {
    const { poll, pipeline } = setUp({ feedIntervalMs: 90_000 });
    poll.mockReturnValue(new Promise(() => {}));
    pipeline.add(Array.from({ length: 15 }, (_, i) => tracker(`feed-${i}`)));

    await pass(60_000);
    expect(poll).toHaveBeenCalledTimes(10);
  });
});

describe('polling again', () => {
  it('counts the interval from the start of the call, not its end', async () => {
    const { poll, pipeline } = setUp();
    const call = deferred<FeedResult>();
    poll.mockReturnValueOnce(call.promise);
    pipeline.add([tracker('a')]);
    await pass(2000);

    await pass(20_000);
    call.resolve(DONE);
    await pass(9999);
    expect(poll).toHaveBeenCalledTimes(1);

    await pass(2001);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('never polls a feed sooner than its interval', async () => {
    const { poll, pipeline } = setUp();
    const starts: number[] = [];
    poll.mockImplementation(() => {
      starts.push(Date.now());
      return Promise.resolve(DONE);
    });
    pipeline.add([tracker('a')]);

    await pass(300_000);
    expect(starts.length).toBeGreaterThan(5);
    for (let i = 1; i < starts.length; i++)
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(30_000);
  });

  it('keeps polling a failing feed on its normal interval: no backoff', async () => {
    const { poll, pipeline } = setUp();
    poll.mockResolvedValue({ ...DONE, error: { kind: 'network', userMessage: 'x' } });
    pipeline.add([tracker('a')]);

    await pass(2000 + 32_000 * 5);
    expect(poll).toHaveBeenCalledTimes(6);
  });

  it('goes to the end of the queue like anybody else', async () => {
    const { poll, pipeline } = setUp({ feedIntervalMs: 4000, callTimeoutMs: 3000 });
    pipeline.add([tracker('a'), tracker('b'), tracker('c')]);
    await pass(10_000);
    expect(polled(poll).slice(0, 5)).toEqual(['a', 'b', 'c', 'a', 'b']);
  });

  it('gives a removed tracker no more calls', async () => {
    const { poll, pipeline } = setUp();
    const a = tracker('a');
    pipeline.add([a]);
    await pass(2000);

    a.removed = true;
    await pass(120_000);
    expect(poll).toHaveBeenCalledOnce();
  });

  it('skips a removed tracker waiting in the queue, in the same tick', async () => {
    const { poll, pipeline } = setUp();
    const a = tracker('a');
    pipeline.add([a, tracker('b')]);
    a.removed = true;

    await pass(2000);
    expect(polled(poll)).toEqual(['b']);
  });

  it('skips a tracker removed while it waited to be due', async () => {
    const { poll, pipeline } = setUp();
    const a = tracker('a');
    a.dueAt = NOW + 5000;
    pipeline.add([a]);
    a.removed = true;

    await pass(20_000);
    expect(poll).not.toHaveBeenCalled();
  });
});

describe('a call that outlasts the feed interval', () => {
  it('warns, never hits the feed twice at once, and queues it when it ends', async () => {
    const { poll, pipeline, lines } = setUp();
    const call = deferred<FeedResult>();
    poll.mockReturnValueOnce(call.promise);
    const a = tracker('a');
    pipeline.add([a]);

    await pass(2000 + 30_000);
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'inReach: the call of G:a outlasted the feed interval',
      }),
    );
    await pass(20_000);
    expect(poll).toHaveBeenCalledOnce();

    call.resolve(DONE);
    await pass(2000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(a.dueWhenDone).toBe(false);
  });

  it('does not queue a tracker removed in the meantime', async () => {
    const { poll, pipeline } = setUp();
    const call = deferred<FeedResult>();
    poll.mockReturnValueOnce(call.promise);
    const a = tracker('a');
    pipeline.add([a]);

    await pass(2000 + 30_000);
    a.removed = true;
    call.resolve(DONE);
    await pass(10_000);
    expect(poll).toHaveBeenCalledOnce();
  });
});

describe('what a call hands over', () => {
  it('gives the source null on a first fetch, and the track after that', async () => {
    const { poll, pipeline } = setUp();
    poll.mockResolvedValueOnce({ ...DONE, points: [point('1', NOW)] });
    pipeline.add([tracker('a')]);

    await pass(2000 + 32_000);
    expect(poll.mock.calls[0]![1]).toBeNull();
    expect(poll.mock.calls[1]![1]?.map((p) => p.id)).toEqual(['1']);
  });

  it('shows the latest point while the call is still running', async () => {
    const { poll, pipeline } = setUp();
    const call = deferred<FeedResult>();
    poll.mockImplementationOnce((_feed, _held, _signal, onLatest) => {
      onLatest([point('1', NOW)]);
      return call.promise;
    });
    const a = tracker('a');
    pipeline.add([a]);

    await pass(2000);
    expect(a.latest?.id).toBe('1');
    expect(a.track).toBeNull();

    call.resolve({ ...DONE, points: [point('1', NOW)] });
    await pass(0);
    expect(a.track?.map((p) => p.id)).toEqual(['1']);
  });

  it('stores the error of a call in the tracker', async () => {
    const { poll, pipeline } = setUp();
    const error = { kind: 'timeout', userMessage: 'No answer' } as const;
    poll.mockResolvedValueOnce({ ...DONE, error });
    const a = tracker('a');
    pipeline.add([a]);

    await pass(2000);
    expect(a.error).toBe(error);
  });
});

describe('the signal of a call', () => {
  it('runs out after the time of the call', async () => {
    const limit = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(limit.signal);
    const { poll, pipeline } = setUp();
    const call = deferred<FeedResult>();
    poll.mockReturnValueOnce(call.promise);
    pipeline.add([tracker('a')]);
    await pass(2000);

    expect(timeout).toHaveBeenCalledWith(25_000);
    const signal = poll.mock.calls[0]![2];
    expect(signal.aborted).toBe(false);

    limit.abort(new DOMException('late', 'TimeoutError'));
    expect(signal.aborted).toBe(true);
    call.resolve(DONE);
  });

  it('fires on a shutdown', async () => {
    const { poll, pipeline, shutdown } = setUp();
    const call = deferred<FeedResult>();
    poll.mockReturnValueOnce(call.promise);
    pipeline.add([tracker('a')]);
    await pass(2000);

    shutdown.abort();
    expect(poll.mock.calls[0]![2].aborted).toBe(true);
    call.resolve(DONE);
  });
});

describe('the log', () => {
  it('names the tracker on a good poll', async () => {
    const { poll, pipeline, lines } = setUp();
    poll.mockResolvedValueOnce({ ...DONE, points: [point('1', NOW)] });
    pipeline.add([tracker('a')]);
    await pass(2000);

    expect(lines).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'inReach poll of G:a: 1 points, 1 request(s), 0 ms',
      }),
    ]);
  });

  it('keeps the status and all the headers of a failure, as a WARN', async () => {
    const { poll, pipeline, lines } = setUp();
    const headers = { 'retry-after': '60', server: 'x' };
    poll.mockResolvedValueOnce({
      ...DONE,
      error: {
        kind: 'throttled',
        userMessage: 'x',
        detail: 'too many',
        status: 429,
        headers,
        retryAfterMs: 60_000,
      },
    });
    pipeline.add([tracker('a')]);
    await pass(2000);

    expect(lines).toEqual([
      {
        level: 'warn',
        message: 'inReach poll of G:a failed: throttled, too many, 1 request(s), 0 ms',
        details: { kind: 'throttled', status: 429, headers, retryAfterMs: 60_000 },
      },
    ]);
  });

  it('logs the warnings of a source, naming the tracker', async () => {
    const { poll, pipeline, lines } = setUp();
    poll.mockResolvedValueOnce({ ...DONE, warnings: ['odd', 'odder'] });
    pipeline.add([tracker('a')]);
    await pass(2000);

    expect(lines.filter((line) => line.level === 'warn').map((line) => line.message)).toEqual([
      'inReach poll of G:a: odd',
      'inReach poll of G:a: odder',
    ]);
  });

  it('makes only the first poll that throws an ERROR, and the feed goes on', async () => {
    const { poll, pipeline, lines } = setUp();
    poll.mockRejectedValue(new Error('bug'));
    pipeline.add([tracker('a'), tracker('b')]);
    await pass(4000 + 32_000);

    expect(lines.map((line) => [line.level, line.message])).toEqual([
      ['error', 'inReach poll of G:a threw; any more this run are WARNs'],
      ['warn', 'inReach poll of G:b threw'],
      ['warn', 'inReach poll of G:a threw'],
      ['warn', 'inReach poll of G:b threw'],
    ]);
  });

  it('says nothing of a poll ended by the shutdown', async () => {
    const { poll, pipeline, lines, shutdown } = setUp();
    const call = deferred<FeedResult>();
    poll.mockReturnValueOnce(call.promise);
    pipeline.add([tracker('a')]);
    await pass(2000);

    shutdown.abort();
    call.reject(new DOMException('stop', 'AbortError'));
    await pass(0);
    expect(lines).toEqual([]);
  });
});

describe('stop', () => {
  it('starts no more calls', async () => {
    const { poll, pipeline } = setUp();
    pipeline.add([tracker('a'), tracker('b')]);
    await pass(2000);

    pipeline.stop();
    await pass(120_000);
    expect(poll).toHaveBeenCalledOnce();
  });
});
