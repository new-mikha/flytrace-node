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

// Garmin's feed: the parser (samples and cases of the legacy InReachFeedRequestTests) and the calls
// (cases of InReachLocationRequestTests, with the differences written down in AGENTS.md).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inReach, parseInReachFeed } from '../../src/tracking/sources/inreach.ts';
import type { FeedPoint } from '../../src/tracking/sources/types.ts';
import { fixture, HOUR, inReachFeed, point, stubFetch } from './helpers.ts';

const FEED = 'share.garmin.com/Feed/Share/pilot#123';
const DAY = 24 * HOUR;
const open = () => new AbortController().signal;
const parse = (name: string, imei = '') => parseInReachFeed(fixture(name), imei) as FeedPoint[];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseInReachFeed', () => {
  it.each(['short-1.kml', 'short-2.kml'])('reads the single point of %s', (name) => {
    expect(parse(name)).toHaveLength(1);
  });

  it.each(['long-1.kml', 'long-2.kml'])('reads the whole of %s, newest first', (name) => {
    const points = parse(name);
    expect(points.length).toBeGreaterThan(100);
    for (let i = 1; i < points.length; i++)
      expect(points[i - 1]!.ts.getTime()).toBeGreaterThan(points[i]!.ts.getTime());

    expect(new Set(points.map((p) => p.lat)).size).toBeGreaterThan(points.length * 0.8);
    expect(new Set(points.map((p) => p.lon)).size).toBeGreaterThan(points.length * 0.8);
  });

  it('does not trim: the 48 h are for merge.ts', () => {
    const points = parse('long-1.kml');
    const span = points[0]!.ts.getTime() - points.at(-1)!.ts.getTime();
    expect(span).toBeGreaterThan(48 * HOUR);
  });

  it('reads the combinations sample', () => {
    const points = parse('combinations.kml');

    expect(points).toHaveLength(4);
    expect(points[3]).toMatchObject({ type: 'TRACK', alt: undefined, userMessage: undefined });
    expect(points[2]).toMatchObject({ type: 'TRACK', alt: undefined, userMessage: undefined });
    expect(points[1]).toMatchObject({ type: 'SOS', userMessage: undefined });
    expect(points[1]!.alt).toBeTypeOf('number');
    expect(points[0]).toMatchObject({ type: 'OK', userMessage: 'kuku' });
    expect(points[0]!.alt).toBeTypeOf('number');
  });

  it('reads longitude first, as KML has it', () => {
    expect(parse('short-1.kml')[0]!.lat).not.toBe(parse('short-1.kml')[0]!.lon);
    const [p] = parseInReachFeed(
      inReachFeed([{ time: '2026-01-10T12:00:00Z' }]),
      '',
    ) as FeedPoint[];
    expect(p).toMatchObject({ lat: 1, lon: 2, alt: 300 });
  });

  it.each(['short-multi-imei.kml', 'long-multi-imei.kml'])('picks one device of %s', (name) => {
    const one = parse(name, '123456789');
    const other = parse(name, '987654321');

    expect(one[0]).not.toEqual(other[0]);
    if (name.startsWith('short')) {
      expect(one).toHaveLength(1);
      expect(other).toHaveLength(1);
    } else {
      expect(one.length).toBeGreaterThan(100);
      expect(other.length).toBeGreaterThan(100);
      expect(one.length).not.toBe(other.length);
    }
  });

  it.each(['short-multi-imei.kml', 'long-multi-imei.kml'])('refuses %s without an IMEI', (name) => {
    const answer = parseInReachFeed(fixture(name), '');
    expect(answer).toMatchObject({ kind: 'source-error' });
    expect((answer as { userMessage: string }).userMessage).toContain('several devices');
  });

  it('finds no data for a device that is not in the feed', () => {
    expect(parseInReachFeed(fixture('short-1.kml'), '555')).toMatchObject({ kind: 'no-data' });
  });

  it('moves repeated times on, a second each, oldest first', () => {
    const count = (name: string) =>
      parse(name).filter((p) => p.ts >= new Date('2019-06-02T00:00:00Z'));

    const previous = count('long-1-same-time-prev.kml');
    const current = count('long-1-same-time.kml');
    expect(previous).toHaveLength(40);
    expect(current).toHaveLength(41);

    const span = (points: FeedPoint[]) => points[0]!.ts.getTime() - points.at(-1)!.ts.getTime();
    expect(span(previous)).toBe(39_000);
    expect(span(current)).toBe(40_000);
  });

  it('gives a repeated time the same result from one request to the next', () => {
    const previous = parse('long-1-same-time-prev.kml');
    const current = parse('long-1-same-time.kml');

    expect(current.at(-1)).toEqual(previous.at(-1));
    // The new point goes on top, and everything else stays put:
    expect(current.slice(1)).toEqual(previous);
  });

  it('copes with the byte order mark Garmin sends', () => {
    expect(parseInReachFeed(`﻿${fixture('short-1.kml')}`, '')).toHaveLength(1);
  });

  it('skips placemarks without a time, a position or a usable time', () => {
    const kml = `<kml><Document>
      <Placemark><name>The line</name></Placemark>
      <Placemark><TimeStamp><when>nonsense</when></TimeStamp>
        <Point><coordinates>2,1</coordinates></Point></Placemark>
      <Placemark><TimeStamp><when>2026-01-10T12:00:00Z</when></TimeStamp></Placemark>
      </Document></kml>`;
    expect(parseInReachFeed(kml, '')).toMatchObject({ kind: 'no-data' });
  });

  it('reports broken XML', () => {
    expect(parseInReachFeed('<kml><oops></kml>', '')).toMatchObject({ kind: 'source-error' });
  });

  it('reports a feed with no points as no data', () => {
    expect(parseInReachFeed('<kml><Document /></kml>', '')).toMatchObject({ kind: 'no-data' });
  });
});

describe('inReach.poll on a first fetch', () => {
  const NEWEST = '2026-01-10T12:00:00Z';
  const window = inReachFeed([
    { id: '1', time: '2026-01-10T11:00:00Z' },
    { id: '2', time: NEWEST },
  ]);
  const latest = inReachFeed([{ id: '2', time: NEWEST }]);

  it('asks for the latest point, then 4 days back from it', async () => {
    const { urls } = stubFetch((_, call) => new Response(call === 0 ? latest : window));
    const result = await inReach.poll(FEED, null, open(), () => {});

    expect(urls).toEqual([
      'https://share.garmin.com/Feed/Share/pilot?imei=123',
      'https://share.garmin.com/Feed/Share/pilot?d1=2026-01-06T12:00:00z&imei=123',
    ]);
    expect(result).toMatchObject({ error: null, requestCount: 2 });
    expect(result.points.map((p) => p.id)).toEqual(['2', '1']);
  });

  it('hands over the latest point before the second request', async () => {
    const seen: string[] = [];
    stubFetch((_, call) => {
      seen.push(`request ${call}`);
      return new Response(call === 0 ? latest : window);
    });
    await inReach.poll(FEED, null, open(), () => seen.push('latest'));
    expect(seen).toEqual(['request 0', 'latest', 'request 1']);
  });

  it('reports a first request that fails, with no points and no second one', async () => {
    const { urls } = stubFetch(() => new Response('', { status: 500 }));
    const onLatest = vi.fn();
    const result = await inReach.poll(FEED, null, open(), onLatest);

    expect(urls).toHaveLength(1);
    expect(onLatest).not.toHaveBeenCalled();
    expect(result).toMatchObject({ points: [], error: { status: 500 }, requestCount: 1 });
  });

  it('keeps the latest point when the second request fails', async () => {
    stubFetch((_, call) => (call === 0 ? new Response(latest) : new Response('', { status: 500 })));
    const result = await inReach.poll(FEED, null, open(), () => {});

    expect(result.points.map((p) => p.id)).toEqual(['2']);
    expect(result).toMatchObject({ error: { status: 500 }, requestCount: 2 });
  });

  it('does the same when the second answer cannot be read', async () => {
    stubFetch((_, call) => new Response(call === 0 ? latest : '<oops'));
    const result = await inReach.poll(FEED, null, open(), () => {});

    expect(result.points.map((p) => p.id)).toEqual(['2']);
    expect(result.error).toMatchObject({ kind: 'source-error' });
  });

  it('needs no second request when the first already reaches back 48 h', async () => {
    const feed = inReachFeed([
      { id: '1', time: '2026-01-07T12:00:00Z' },
      { id: '2', time: NEWEST },
    ]);
    const { urls } = stubFetch(() => new Response(feed));
    const result = await inReach.poll(FEED, null, open(), () => {});

    expect(urls).toHaveLength(1);
    expect(result).toMatchObject({ error: null, requestCount: 1 });
    expect(result.points).toHaveLength(2);
  });

  it('still asks for the window when the first gives points close together', async () => {
    const feed = inReachFeed([
      { id: '1', time: '2026-01-09T12:00:01Z' },
      { id: '2', time: NEWEST },
    ]);
    const { urls } = stubFetch(() => new Response(feed));
    await inReach.poll(FEED, null, open(), () => {});
    expect(urls).toHaveLength(2);
  });

  it('treats an empty held track as no track', async () => {
    const { urls } = stubFetch(() => new Response(latest));
    await inReach.poll(FEED, [], open(), () => {});
    expect(urls[0]).not.toContain('d1=');
  });
});

describe('inReach.poll with a track held', () => {
  const T = Date.parse('2026-01-10T12:00:00Z');
  const iso = (time: number) => new Date(time).toISOString().replace('.000', '');
  const held = [point('3', T), point('2', T - HOUR), point('1', T - 2 * HOUR)];
  const feedOf = (...points: FeedPoint[]) =>
    inReachFeed([...points].reverse().map((p) => ({ id: p.id, time: p.ts.toISOString() })));

  it('asks once, for 4 days back from the newest point held', async () => {
    const { urls } = stubFetch(() => new Response(feedOf(...held)));
    await inReach.poll(FEED, held, open(), () => {});

    expect(urls).toEqual([
      `https://share.garmin.com/Feed/Share/pilot?d1=${iso(T - 4 * DAY).replace('Z', 'z')}&imei=123`,
    ]);
  });

  it('stops when the newest point is the one held: nothing is new', async () => {
    stubFetch(() => new Response(feedOf(...held)));
    const result = await inReach.poll(FEED, held, open(), () => {});
    expect(result).toEqual({ points: [], error: null, requestCount: 1 });
  });

  it('goes by the Id, not the time, to tell that nothing is new', async () => {
    const moved = point('3', T + 1000);
    stubFetch(() => new Response(feedOf(moved, held[1]!, held[2]!)));
    const result = await inReach.poll(FEED, held, open(), () => {});
    expect(result.points).toEqual([]);
  });

  it('brings every new point in that one request', async () => {
    const fresh = [point('5', T + 2 * HOUR), point('4', T + HOUR)];
    const { urls } = stubFetch(() => new Response(feedOf(...fresh, ...held)));
    const result = await inReach.poll(FEED, held, open(), () => {});

    expect(urls).toHaveLength(1);
    expect(result.error).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.points.map((p) => p.id)).toEqual(['5', '4', '3', '2', '1']);
  });

  it('leaves the marker and the track to change together, at the end of the call', async () => {
    stubFetch(() => new Response(feedOf(point('4', T + HOUR), ...held)));
    const onLatest = vi.fn();
    await inReach.poll(FEED, held, open(), onLatest);
    expect(onLatest).not.toHaveBeenCalled();
  });

  it('drops a known point that moved in time, and says so', async () => {
    const moved = point('2', T - HOUR + 5000);
    const fresh = [point('4', T + HOUR), held[0]!, moved, held[2]!];
    stubFetch(() => new Response(feedOf(...fresh)));
    const result = await inReach.poll(FEED, held, open(), () => {});

    expect(result.points.map((p) => p.id)).toEqual(['4', '3', '1']);
    expect(result.warnings).toEqual(['1 known point(s) moved in time, ignored']);
  });

  it('keeps every point when the held track has no ids', async () => {
    const noIds = held.map((p) => ({ ...p, id: undefined }));
    stubFetch(() => new Response(feedOf(point('4', T + HOUR), ...held)));
    const result = await inReach.poll(FEED, noIds, open(), () => {});

    expect(result.points).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });

  it('keeps fresh points that have no Id', async () => {
    const fresh = [point(undefined, T + HOUR), ...held];
    stubFetch(() => new Response(feedOf(...fresh)));
    const result = await inReach.poll(FEED, held, open(), () => {});

    expect(result.points).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });

  it('gives up on the check when the held track has an Id twice', async () => {
    const twice = [held[0]!, point('same', T - HOUR), point('same', T - 2 * HOUR)];
    const moved = point('same', T - HOUR + 5000);
    stubFetch(() => new Response(feedOf(point('4', T + HOUR), held[0]!, moved)));
    const result = await inReach.poll(FEED, twice, open(), () => {});

    expect(result.points.map((p) => p.id)).toEqual(['4', '3', 'same']);
    expect(result.warnings).toEqual(['the same Id is on two points, moved points not checked']);
  });

  it('reports a failure with no points, so the next call tries again', async () => {
    stubFetch(() => new Response('', { status: 503 }));
    const result = await inReach.poll(FEED, held, open(), () => {});
    expect(result).toMatchObject({ points: [], error: { status: 503 }, requestCount: 1 });
  });

  it('reports a window with no points as no data', async () => {
    stubFetch(() => new Response('<kml />'));
    const result = await inReach.poll(FEED, held, open(), () => {});
    expect(result).toMatchObject({ points: [], error: { kind: 'no-data' } });
  });
});

describe('the address of a feed', () => {
  const feed = inReachFeed([{ id: '1', time: '2026-01-10T12:00:00Z' }]);

  it('is always https, with no IMEI when it has none', async () => {
    const { urls } = stubFetch(() => new Response(feed));
    await inReach.poll('http://share.garmin.com/Feed/Share/pilot', null, open(), () => {});
    expect(urls[0]).toBe('https://share.garmin.com/Feed/Share/pilot');
  });

  it('refuses a stored address that brings a query of its own', async () => {
    const { urls } = stubFetch(() => new Response(feed));
    const result = await inReach.poll(
      'share.garmin.com/Feed/Share/pilot?a=1#123',
      null,
      open(),
      () => {},
    );

    expect(urls).toHaveLength(0);
    expect(result.error).toMatchObject({ kind: 'source-error' });
  });
});

describe('inReach.parseFeedId', () => {
  const WANTED = { feedId: 'share.garmin.com/Feed/Share/pilot#123456' };

  it.each([
    'pilot#123456',
    'share.garmin.com/pilot#123456',
    'https://share.garmin.com/pilot#123456',
    'https://share.garmin.com/Feed/Share/pilot#123456',
    'https://eur.explore.garmin.com/Feed/Share/pilot?x=1#123456',
    '  pilot # 123456  ',
  ])('reads %s', (text) => {
    expect(inReach.parseFeedId(text)).toEqual(WANTED);
  });

  it('needs the IMEI', () => {
    const answer = inReach.parseFeedId('share.garmin.com/pilot');
    expect(answer).toHaveProperty('error');
    expect((answer as { error: string }).error).toContain('IMEI');
  });

  it('refuses another site', () => {
    expect(inReach.parseFeedId('https://example.com/pilot#123')).toHaveProperty('error');
  });
});

describe('inReach.rules', () => {
  it('are the legacy numbers, with a call shorter than the 30 seconds', () => {
    expect(inReach.rules).toEqual({
      startGapMs: 2000,
      maxInFlight: 10,
      feedIntervalMs: 30_000,
      callTimeoutMs: 25_000,
    });
  });
});
