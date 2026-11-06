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

// What is kept of a track: the same for every source.
import { describe, expect, it } from 'vitest';
import { mergeTrack, TRACK_HOURS } from '../../src/tracking/merge.ts';
import { HOUR, point } from './helpers.ts';

const T = Date.parse('2026-01-10T12:00:00Z');
const ids = (points: { id?: string }[]) => points.map((p) => p.id);

describe('mergeTrack', () => {
  it('is empty for nothing', () => {
    expect(mergeTrack([], [])).toEqual([]);
  });

  it('puts the union newest first, wherever the fresh points fall', () => {
    const held = [point('c', T - 2 * HOUR), point('a', T - 4 * HOUR)];
    const fresh = [point('d', T - HOUR), point('b', T - 3 * HOUR)];
    expect(ids(mergeTrack(held, fresh))).toEqual(['d', 'c', 'b', 'a']);
  });

  it('keeps the held point when a fresh one has the same time', () => {
    const merged = mergeTrack([point('held', T)], [point('fresh', T)]);
    expect(ids(merged)).toEqual(['held']);
  });

  it('drops repeated times within the fresh points too, keeping the first', () => {
    expect(ids(mergeTrack([], [point('a', T), point('b', T)]))).toEqual(['a']);
  });

  it('trims to 48 h behind the newest point, not behind now', () => {
    const limit = T - TRACK_HOURS * HOUR;
    const merged = mergeTrack(
      [],
      [point('newest', T), point('in', limit + 1), point('edge', limit), point('out', limit - 1)],
    );
    expect(ids(merged)).toEqual(['newest', 'in']);
  });

  it('moves the 48 h along with a newer point', () => {
    const held = [point('old', T)];
    expect(ids(mergeTrack(held, [point('new', T + 49 * HOUR)]))).toEqual(['new']);
  });

  it('leaves its arguments alone', () => {
    const held = [point('a', T - HOUR)];
    const fresh = [point('b', T)];
    mergeTrack(held, fresh);
    expect(ids(held)).toEqual(['a']);
    expect(ids(fresh)).toEqual(['b']);
  });
});
