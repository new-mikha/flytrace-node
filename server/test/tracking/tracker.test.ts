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

// One feed in memory: how long it lives, and what a call leaves in it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedError } from '../../src/tracking/sources/types.ts';
import { Tracker } from '../../src/tracking/tracker.ts';
import { point } from './helpers.ts';

const MINUTE = 60_000;
const T = Date.parse('2026-01-10T12:00:00Z');
const error: FeedError = { kind: 'timeout', userMessage: 'No answer' };

describe('the lifetime of a Tracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends 20 minutes after the last access', () => {
    const onRemove = vi.fn();
    const tracker = new Tracker('S:a', 'a', onRemove);
    tracker.resetRemovingTimer();

    vi.advanceTimersByTime(20 * MINUTE - 1);
    expect(tracker.removed).toBe(false);
    expect(onRemove).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(tracker.removed).toBe(true);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('does not keep the process alive', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    new Tracker('S:a', 'a', () => {}).resetRemovingTimer();
    expect((setTimeoutSpy.mock.results[0]!.value as NodeJS.Timeout).hasRef()).toBe(false);
    setTimeoutSpy.mockRestore();
  });

  it('is put off by every access', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.resetRemovingTimer();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(19 * MINUTE);
      tracker.resetRemovingTimer();
    }
    expect(tracker.removed).toBe(false);

    vi.advanceTimersByTime(20 * MINUTE);
    expect(tracker.removed).toBe(true);
  });
});

describe('Tracker.applyLatest', () => {
  it('shows the position while the track is still coming', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyLatest([point('1', T)]);

    expect(tracker.answered).toBe(true);
    expect(tracker.latest?.id).toBe('1');
    expect(tracker.previous).toBeNull();
    expect(tracker.track).toBeNull();
  });

  it('takes the previous point from the held track, and leaves the track alone', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyResult({ points: [point('1', T)], error: null, requestCount: 1 });

    tracker.applyLatest([point('2', T + MINUTE)]);

    expect(tracker.latest?.id).toBe('2');
    expect(tracker.previous?.id).toBe('1');
    expect(tracker.track?.map((p) => p.id)).toEqual(['1']);
  });

  it('keeps what it has when there are no points', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyResult({ points: [point('1', T)], error: null, requestCount: 1 });
    tracker.applyLatest([]);
    expect(tracker.latest?.id).toBe('1');
  });
});

describe('Tracker.applyLatest with no track', () => {
  it('keeps the position it got when there are no points', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyLatest([point('1', T)]);
    tracker.applyLatest([]);
    expect(tracker.latest?.id).toBe('1');
  });
});

describe('Tracker.applyResult', () => {
  it('sets the track, the position and the previous point', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyResult({
      points: [point('2', T), point('1', T - MINUTE)],
      error: null,
      requestCount: 1,
    });

    expect(tracker.track?.map((p) => p.id)).toEqual(['2', '1']);
    expect(tracker.latest?.id).toBe('2');
    expect(tracker.previous?.id).toBe('1');
    expect(tracker.error).toBeNull();
  });

  it('merges into the track it holds', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyResult({ points: [point('1', T)], error: null, requestCount: 1 });
    tracker.applyResult({ points: [point('2', T + MINUTE)], error: null, requestCount: 1 });
    expect(tracker.track?.map((p) => p.id)).toEqual(['2', '1']);
  });

  it('answers with the error alone when a first fetch fails at once', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyResult({ points: [], error, requestCount: 1 });

    expect(tracker.answered).toBe(true);
    expect(tracker.error).toBe(error);
    expect(tracker.latest).toBeNull();
    expect(tracker.track).toBeNull();
  });

  it('keeps no track from a first fetch that failed half way, but keeps the position', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyLatest([point('2', T)]);
    tracker.applyResult({ points: [point('2', T)], error, requestCount: 2 });

    expect(tracker.track).toBeNull();
    expect(tracker.latest?.id).toBe('2');
    expect(tracker.error).toBe(error);
  });

  it('keeps track and position through an error once a track is held', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyResult({ points: [point('1', T)], error: null, requestCount: 1 });
    tracker.applyResult({ points: [], error, requestCount: 1 });

    expect(tracker.track?.map((p) => p.id)).toEqual(['1']);
    expect(tracker.latest?.id).toBe('1');
    expect(tracker.error).toBe(error);
  });

  it('clears an old error when a call goes well, even with nothing new', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyResult({ points: [point('1', T)], error, requestCount: 1 });
    tracker.applyResult({ points: [], error: null, requestCount: 1 });

    expect(tracker.error).toBeNull();
    expect(tracker.latest).toBeNull();
  });

  it('leaves a position from applyLatest when a good call brings no points', () => {
    const tracker = new Tracker('S:a', 'a', () => {});
    tracker.applyLatest([point('1', T)]);
    tracker.applyResult({ points: [], error: null, requestCount: 1 });
    expect(tracker.latest?.id).toBe('1');
  });
});
