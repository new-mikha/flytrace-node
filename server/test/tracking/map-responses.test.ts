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

// The JSON replies to the map page: the legacy rules of what is shown, and what is left out.
import { describe, expect, it } from 'vitest';
import type { MapView, MapViewTracker } from '../../src/repo/mapGroups.ts';
import { coordinates, tracks } from '../../src/tracking/mapResponses.ts';
import type { FeedError, FeedPoint } from '../../src/tracking/sources/types.ts';
import { Tracker } from '../../src/tracking/tracker.ts';
import { point } from './helpers.ts';

const NOW = new Date('2026-01-10T12:00:00Z');
const ago = (seconds: number) => NOW.getTime() - seconds * 1000;

const row = (name: string, isOn = true): MapViewTracker => ({
  name,
  type: 'S',
  feedId: name,
  isOn,
});

const view = (more: Partial<MapView> = {}): MapView => ({
  showMessages: false,
  altitudeUnits: null,
  startTs: null,
  trackers: [row('Pilot')],
  ...more,
});

function holding(points: FeedPoint[], error: FeedError | null = null): Tracker {
  const tracker = new Tracker('S:a', 'a', () => {});
  tracker.applyResult({ points, error, requestCount: 1 });
  return tracker;
}

const waiting = () => new Tracker('S:a', 'a', () => {});
const firstOf = (v: MapView, tracker: Tracker) => coordinates(v, [tracker], NOW).trackers[0]!;

describe('coordinates', () => {
  it('says "wait" for a feed that has not answered, and nothing else', () => {
    expect(firstOf(view(), waiting())).toEqual({ name: 'Pilot', type: 'wait' });
  });

  it('marks a tracker turned off as hidden, even while waiting', () => {
    const v = view({ trackers: [row('Pilot', false)] });
    expect(firstOf(v, waiting())).toEqual({ name: 'Pilot', type: 'wait', hidden: true });
  });

  it('gives the position, its age, and the previous point', () => {
    const tracker = holding([
      point('2', ago(90), { lat: 10, lon: 20, type: 'OK' }),
      point('1', ago(300), { lat: 11, lon: 21 }),
    ]);

    expect(firstOf(view(), tracker)).toEqual({
      name: 'Pilot',
      lat: 10,
      lon: 20,
      type: 'OK',
      ts: new Date(ago(90)),
      age: 90,
      prevLat: 11,
      prevLon: 21,
      prevTs: new Date(ago(300)),
      prevAge: 300,
    });
  });

  it('shows the pilot by the name of the group, not of the feed', () => {
    const trackers = [row('Anna')];
    expect(firstOf(view({ trackers }), holding([point('1', ago(10))])).name).toBe('Anna');
  });

  it('gives only the error for a feed that never had a position', () => {
    const error: FeedError = { kind: 'bad-feed-id', userMessage: 'Unknown feed' };
    expect(firstOf(view(), holding([], error))).toEqual({ name: 'Pilot', error: 'Unknown feed' });
  });

  it('gives a stale position together with a fresh error', () => {
    const tracker = holding([point('1', ago(10))]);
    tracker.applyResult({
      points: [],
      error: { kind: 'timeout', userMessage: 'No answer' },
      requestCount: 1,
    });
    expect(firstOf(view(), tracker)).toMatchObject({ lat: 1, error: 'No answer' });
  });

  it('never gives a negative age, for a device ahead of our clock', () => {
    expect(firstOf(view(), holding([point('1', ago(-30))])).age).toBeUndefined();
  });

  it('counts the age in whole seconds', () => {
    const tracker = holding([point('1', NOW.getTime() - 1999)]);
    expect(firstOf(view(), tracker).age).toBe(1);
  });

  it('gives the altitude only when the owner chose units, and always in metres', () => {
    const tracker = holding([point('1', ago(10), { alt: 1500 })]);
    expect(firstOf(view(), tracker).alt).toBeUndefined();
    expect(firstOf(view({ altitudeUnits: 'ft' }), tracker).alt).toBe(1500);
  });

  it('gives the message only when the group shows messages', () => {
    const tracker = holding([point('1', ago(10), { userMessage: 'Landed' })]);
    expect(firstOf(view(), tracker).usrMsg).toBeUndefined();
    expect(firstOf(view({ showMessages: true }), tracker).usrMsg).toBe('Landed');
  });

  it('leaves zeros out: tracker-api.js puts them back', () => {
    const item = firstOf(view(), holding([point('1', NOW.getTime(), { lat: 0, lon: 0 })]));
    expect(item).not.toHaveProperty('lat');
    expect(item).not.toHaveProperty('lon');
    expect(item).not.toHaveProperty('age');
  });

  describe('with "hide points older than"', () => {
    const startTs = new Date(ago(100));

    it('hides a current point older than that', () => {
      expect(firstOf(view({ startTs }), holding([point('1', ago(200))])).hidden).toBe(true);
    });

    it('shows a newer one', () => {
      const item = firstOf(view({ startTs }), holding([point('1', ago(50))]));
      expect(item).not.toHaveProperty('hidden');
    });

    it('leaves out a previous point older than that, so no line leads to it', () => {
      const item = firstOf(view({ startTs }), holding([point('2', ago(50)), point('1', ago(200))]));
      expect(item).not.toHaveProperty('prevTs');
      expect(item).not.toHaveProperty('prevLat');
    });

    it('keeps a previous point newer than that', () => {
      const item = firstOf(view({ startTs }), holding([point('2', ago(50)), point('1', ago(70))]));
      expect(item.prevTs).toEqual(new Date(ago(70)));
    });

    it('leaves out a previous point at that very time', () => {
      const item = firstOf(view({ startTs }), holding([point('2', ago(50)), point('1', ago(100))]));
      expect(item).not.toHaveProperty('prevTs');
    });
  });

  it('gives the whole group, in order, with what the page needs of the group', () => {
    const startTs = new Date(ago(1000));
    const v = view({ altitudeUnits: 'm', startTs, trackers: [row('A'), row('B')] });
    const answer = coordinates(v, [waiting(), holding([point('1', ago(10))])], NOW);

    expect(answer.trackers.map((t) => t.name)).toEqual(['A', 'B']);
    expect(answer).toMatchObject({ altitudeUnits: 'm', startTs, ver: expect.any(Number) });
  });

  it('leaves the group values out when empty, but never the version', () => {
    const answer = coordinates(view({ trackers: [] }), [], NOW);
    expect(Object.keys(answer).sort()).toEqual(['trackers', 'ver']);
  });
});

describe('tracks', () => {
  const held = () =>
    holding([point('3', ago(10), { type: 'OK' }), point('2', ago(20)), point('1', ago(30))]);

  it('gives the whole track newest first, with the type on the newest point only', () => {
    const [item] = tracks([row('Pilot')], [held()], { items: [{ trackerName: 'Pilot' }] }, NOW);

    expect(item).toEqual({
      trackerName: 'Pilot',
      track: [
        { lat: 1, lon: 2, ts: new Date(ago(10)), age: 10, type: 'OK' },
        { lat: 1, lon: 2, ts: new Date(ago(20)), age: 20 },
        { lat: 1, lon: 2, ts: new Date(ago(30)), age: 30 },
      ],
    });
  });

  it('gives only what is newer than the page holds', () => {
    const request = {
      items: [{ trackerName: 'Pilot', laterThan: new Date(ago(20)).toISOString() }],
    };
    const [item] = tracks([row('Pilot')], [held()], request as never, NOW);
    expect(item!.track.map((p) => p.age)).toEqual([10]);
  });

  it('matches the names in any case, and answers with the name of the group', () => {
    const [item] = tracks([row('Pilot')], [held()], { items: [{ trackerName: 'PILOT' }] }, NOW);
    expect(item!.trackerName).toBe('Pilot');
  });

  it('leaves out a tracker with no track yet, so the page asks again', () => {
    const answer = tracks([row('Pilot')], [waiting()], { items: [{ trackerName: 'Pilot' }] }, NOW);
    expect(answer).toEqual([]);
  });

  it('leaves out a tracker with nothing newer', () => {
    const request = {
      items: [{ trackerName: 'Pilot', laterThan: new Date(ago(10)).toISOString() }],
    };
    expect(tracks([row('Pilot')], [held()], request as never, NOW)).toEqual([]);
  });
});
