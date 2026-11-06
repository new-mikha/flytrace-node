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

// SPOT's feed: the parser (the samples and cases of the legacy SpotFeedRequestTests) and the paging.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSpotPage, spot } from '../../src/tracking/sources/spot.ts';
import type { FeedPoint } from '../../src/tracking/sources/types.ts';
import { fixture, HOUR, point, spotError, spotPage, stubFetch } from './helpers.ts';

const FEED = 'feed-id-of-twenty-chars';
const NEWEST = '2026-01-10T12:00:00Z';
const open = () => new AbortController().signal;
const parse = (xml: string) => parseSpotPage(xml, FEED) as FeedPoint[];

const message = (fields: string) =>
  `<response><feedMessageResponse><messages><message>${fields}</message></messages></feedMessageResponse></response>`;
const FIELDS = `<latitude>1.5</latitude><longitude>2.5</longitude>
  <messageType>TRACK</messageType><dateTime>2018-04-10T06:31:11+0000</dateTime>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseSpotPage', () => {
  it('reads the basic sample, newest first', () => {
    const points = parse(fixture('spot-basic.xml'));

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ type: 'OK', lat: 1, lon: 2 });
    expect(points[1]).toMatchObject({ type: 'TRACK', lat: 3, lon: 4 });
    expect(points[0]!.ts.getTime()).toBeGreaterThan(points[1]!.ts.getTime());
  });

  it('reads the combinations sample and skips its broken messages', () => {
    const xml = fixture('spot-combinations.xml');
    const messages = xml.match(/<message /g)!.length;
    const points = parse(xml);

    expect(points).toHaveLength(messages - 4);
    let time = points[0]!.ts.getTime();
    for (const [i, p] of points.entries()) {
      const lat = Math.trunc(p.lat);
      const lon = Math.trunc(p.lon);
      expect([1, 2, 11, 12]).toContain(lat);
      expect([20, 21]).toContain(lon);
      expect(p.ts.getTime()).toBe(time);
      // The last two messages of the sample have the same time:
      if (i < points.length - 2) time -= 10 * 60_000;

      expect(p.alt).toBe(lat === 11 || lat === 12 ? 123 : undefined);
      expect(p.type).toBe(lon === 20 ? 'OK' : 'TRACK');
      expect(p.userMessage).toBe(lat === 1 || lat === 11 ? 'Need beer and retrieve' : undefined);
    }
  });

  it('reads the time with its +0000', () => {
    expect(parse(message(FIELDS))[0]!.ts.toISOString()).toBe('2018-04-10T06:31:11.000Z');
  });

  it('falls back to the unix time', () => {
    const fields = `<latitude>1</latitude><longitude>2</longitude>
      <messageType>OK</messageType><unixTime>1523341871</unixTime>`;
    expect(parse(message(fields))[0]!.ts.toISOString()).toBe('2018-04-10T06:31:11.000Z');
  });

  it.each([
    ['TEST', 'OK'],
    ['STOP', 'OK'],
    ['HELP-CANCEL', 'OK'],
    ['EXTREME-TRACK', 'TRACK'],
    ['UNLIMITED-TRACK', 'TRACK'],
    ['NEWMOVEMENT', 'TRACK'],
    ['POI', 'TRACK'],
    ['HELP', 'HELP'],
    ['CUSTOM', 'CUSTOM'],
    ['SOS', 'SOS'],
  ])('shows the status %s as %s', (status, type) => {
    const fields = FIELDS.replace('TRACK', status);
    expect(parse(message(fields))[0]!.type).toBe(type);
  });

  it('keeps ids as text, and never a negative altitude', () => {
    const [p] = parse(message(`${FIELDS}<id>0012</id><altitude>-12.7</altitude>`));
    expect(p).toMatchObject({ id: '0012', alt: 0 });
  });

  it('takes an altitude of 0 as none, and trims the message', () => {
    const [p] = parse(
      message(`${FIELDS}<altitude>0</altitude><messageContent>  hi  </messageContent>`),
    );
    expect(p!.alt).toBeUndefined();
    expect(p!.userMessage).toBe('hi');
  });

  it('reports no messages as no data', () => {
    expect(parseSpotPage(spotError('No Messages to display'), FEED)).toMatchObject({
      kind: 'no-data',
    });
  });

  it.each(['Feed Not Found', 'Feed Currently Not Active', 'Feed Password required'])(
    'reports "%s" as a bad feed id',
    (text) => {
      expect(parseSpotPage(spotError(text), FEED)).toMatchObject({ kind: 'bad-feed-id' });
    },
  );

  it('takes an unknown error for no data, and keeps the feed id out of it', () => {
    const answer = parseSpotPage(spotError(`Trouble with ${FEED} today`), FEED);
    expect(answer).toMatchObject({ kind: 'no-data', detail: 'Trouble with <feed> today' });
  });

  it('reports broken XML', () => {
    expect(parseSpotPage('<response><oops></response>', FEED)).toMatchObject({
      kind: 'source-error',
    });
  });

  it('reports messages with no usable point: their format must have changed', () => {
    expect(parseSpotPage(message('<nothing>here</nothing>'), FEED)).toMatchObject({
      kind: 'source-error',
      userMessage: 'Inconsistent SPOT server response schema.',
    });
  });

  it('reports a page with no messages at all as no data', () => {
    expect(parseSpotPage('<response></response>', FEED)).toMatchObject({ kind: 'no-data' });
  });
});

describe('spot.poll on a first fetch', () => {
  const poll = (onLatest: (points: FeedPoint[]) => void = () => {}) =>
    spot.poll(FEED, null, open(), onLatest);

  it('stops at a page that is not full', async () => {
    const { urls } = stubFetch(() => new Response(spotPage(49, NEWEST, 1)));
    const result = await poll();

    expect(urls).toHaveLength(1);
    expect(result).toMatchObject({ error: null, requestCount: 1 });
    expect(result.points).toHaveLength(49);
  });

  it('reads on through full pages, counting messages from 1', async () => {
    const pages = [50, 50, 10];
    const { urls } = stubFetch((_, call) => {
      const newest = new Date(Date.parse(NEWEST) - call * 50 * 60_000).toISOString();
      return new Response(spotPage(pages[call]!, newest, 1));
    });
    const result = await poll();

    expect(urls).toEqual([
      expect.stringMatching(new RegExp(`/public/feed/${FEED}/message\\.xml$`)),
      expect.stringMatching(/message\.xml\?start=51$/),
      expect.stringMatching(/message\.xml\?start=101$/),
    ]);
    expect(result.points).toHaveLength(110);
    expect(result.requestCount).toBe(3);
  });

  it('reads on past a full page with a repeated time: fullness counts messages', async () => {
    const repeated = spotPage(50, NEWEST, 1).replace(
      /<dateTime>[^<]*<\/dateTime>(?=<\/message><message>)/,
      `<dateTime>${new Date(Date.parse(NEWEST) - 60_000).toISOString().slice(0, 19)}+0000</dateTime>`,
    );
    const { urls } = stubFetch((_, call) =>
      call === 0 ? new Response(repeated) : new Response(spotPage(5, NEWEST, 100)),
    );
    await poll();
    expect(urls).toHaveLength(2);
  });

  it('stops at once when the first page already spans 48 h, and trims it', async () => {
    const { urls } = stubFetch(() => new Response(spotPage(50, NEWEST, 120)));
    const result = await poll();

    expect(urls).toHaveLength(1);
    expect(result.points).toHaveLength(24);
  });

  it('stops once the pages span 48 h', async () => {
    const { urls } = stubFetch((_, call) => {
      const newest = new Date(Date.parse(NEWEST) - call * 25 * HOUR).toISOString();
      return new Response(spotPage(50, newest, 30));
    });
    await poll();
    expect(urls).toHaveLength(2);
  });

  it('never reads more than 6 pages', async () => {
    const { urls } = stubFetch((_, call) => {
      const newest = new Date(Date.parse(NEWEST) - call * 50 * 60_000).toISOString();
      return new Response(spotPage(50, newest, 1));
    });
    const result = await poll();

    expect(urls).toHaveLength(6);
    expect(result.points).toHaveLength(300);
  });

  it('hands over the first page only, as soon as it is in', async () => {
    stubFetch((_, call) => {
      const newest = new Date(Date.parse(NEWEST) - call * 50 * 60_000).toISOString();
      return new Response(spotPage(call === 0 ? 50 : 5, newest, 1));
    });
    const onLatest = vi.fn();
    await poll(onLatest);

    expect(onLatest).toHaveBeenCalledOnce();
    expect(onLatest.mock.calls[0]![0]).toHaveLength(50);
  });

  it('takes running out of messages on a later page as the end of them', async () => {
    stubFetch((_, call) =>
      call === 0
        ? new Response(spotPage(50, NEWEST, 1))
        : new Response(spotError('No Messages to display')),
    );
    const result = await poll();

    expect(result.error).toBeNull();
    expect(result.points).toHaveLength(50);
    expect(result.requestCount).toBe(2);
  });

  it('reports no messages on the first page', async () => {
    stubFetch(() => new Response(spotError('No Messages to display')));
    const result = await poll();
    expect(result).toMatchObject({ points: [], error: { kind: 'no-data' } });
  });

  it('gives the pages so far with the error of a later one', async () => {
    stubFetch((_, call) =>
      call === 0 ? new Response(spotPage(50, NEWEST, 1)) : new Response('', { status: 500 }),
    );
    const result = await poll();

    expect(result.points).toHaveLength(50);
    expect(result.error).toMatchObject({ kind: 'source-error', status: 500 });
    expect(result.requestCount).toBe(2);
  });

  it('does the same for a later page it cannot read', async () => {
    stubFetch((_, call) =>
      call === 0 ? new Response(spotPage(50, NEWEST, 1)) : new Response('<oops'),
    );
    const result = await poll();

    expect(result.points).toHaveLength(50);
    expect(result.error).toMatchObject({ kind: 'source-error' });
  });

  it('reports a failure of the first page, with no points', async () => {
    stubFetch(() => new Response('', { status: 404 }));
    const result = await poll();
    expect(result).toMatchObject({ points: [], error: { kind: 'bad-feed-id' }, requestCount: 1 });
  });
});

describe('spot.poll with a track held', () => {
  it('reads the top page only, even a full one', async () => {
    const { urls } = stubFetch(() => new Response(spotPage(50, NEWEST, 1)));
    const held = [point('1', Date.parse(NEWEST) - HOUR)];
    const result = await spot.poll(FEED, held, open(), () => {});

    expect(urls).toHaveLength(1);
    expect(result.points).toHaveLength(50);
  });
});

describe('spot.parseFeedId', () => {
  const ID = '0aBcDeFgHiJkLmNoPqRsTuVwXyZ';

  it('takes the id alone, or the link of a Shared Page', () => {
    expect(spot.parseFeedId(ID)).toEqual({ feedId: ID });
    expect(spot.parseFeedId(`  ${ID} `)).toEqual({ feedId: ID });
    expect(
      spot.parseFeedId(`https://share.findmespot.com/shared/faces/viewspots.jsp?glId=${ID}`),
    ).toEqual({ feedId: ID });
  });

  it('refuses what is too short, too long or not an id', () => {
    expect(spot.parseFeedId('short')).toHaveProperty('error');
    expect(spot.parseFeedId('x'.repeat(51))).toHaveProperty('error');
    expect(spot.parseFeedId('https://example.com/page')).toHaveProperty('error');
  });
});

describe('spot.rules', () => {
  it('are the legacy numbers', () => {
    expect(spot.rules).toEqual({
      startGapMs: 2000,
      maxInFlight: 10,
      feedIntervalMs: 150_000,
      callTimeoutMs: 60_000,
    });
  });
});
