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

// What is asked of the services when a tracker is added: the rules of the legacy manageGroup page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFeed } from '../../src/routes/groups.tsx';
import { sources } from '../../src/tracking/sources/index.ts';
import { inReach } from '../../src/tracking/sources/inreach.ts';
import { spot } from '../../src/tracking/sources/spot.ts';
import { fakeLog, fixture, inReachFeed, spotError, spotPage, stubFetch } from './helpers.ts';

const SPOT_ID = 'feed-id-of-twenty-chars';
const ADDRESS = 'share.garmin.com/Feed/Share/pilot';
const open = () => new AbortController().signal;
const checkSpot = () => spot.checkFeed(SPOT_ID, open());
const checkInReach = (imei = '') => inReach.checkFeed(`${ADDRESS}#${imei}`, open());

const oneDevice = inReachFeed([{ time: '2026-01-10T12:00:00Z', imei: '111' }]);
const twoDevices = inReachFeed([
  { time: '2026-01-09T12:00:00Z', imei: '111' },
  { time: '2026-01-10T12:00:00Z', imei: '222' },
]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkFeed of the route', () => {
  const real = sources.S;
  const parsed = { type: 'S', foreignId: SPOT_ID } as const;

  afterEach(() => {
    sources.S = real;
    vi.restoreAllMocks();
  });

  it('gives the service the time of one of its calls', async () => {
    const limit = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(limit.signal);
    const checkFeedOfSource = vi.fn(() => Promise.resolve({ feedId: SPOT_ID }));
    sources.S = { ...real, checkFeed: checkFeedOfSource };

    await checkFeed({ log: fakeLog().log }, parsed);
    expect(timeout).toHaveBeenCalledWith(real.rules.callTimeoutMs);
    expect(checkFeedOfSource).toHaveBeenCalledWith(SPOT_ID, limit.signal);
  });

  it('logs a failure of the service as a WARN, with its status and headers', async () => {
    const headers = { 'retry-after': '60' };
    const failure = {
      kind: 'throttled',
      userMessage: 'x',
      status: 429,
      headers,
      retryAfterMs: 60_000,
    } as const;
    sources.S = { ...real, checkFeed: () => Promise.resolve({ feedId: SPOT_ID, failure }) };
    const { lines, log } = fakeLog();

    await checkFeed({ log }, parsed);
    expect(lines).toEqual([
      {
        level: 'warn',
        message: `SPOT check of S:${SPOT_ID} failed: throttled`,
        details: { kind: 'throttled', status: 429, headers, retryAfterMs: 60_000 },
      },
    ]);
  });

  it('logs nothing when the service answered', async () => {
    sources.S = { ...real, checkFeed: () => Promise.resolve({ error: 'No such feed' }) };
    const { lines, log } = fakeLog();

    await checkFeed({ log }, parsed);
    expect(lines).toEqual([]);
  });
});

describe('spot.checkFeed', () => {
  it('asks for the top page only, and takes a feed with messages', async () => {
    const { urls } = stubFetch(() => new Response(spotPage(50, '2026-01-10T12:00:00Z', 1)));
    expect(await checkSpot()).toEqual({ feedId: SPOT_ID });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(new RegExp(`/${SPOT_ID}/message\\.xml$`));
  });

  it('takes a feed with no messages yet, as nothing is wrong with it', async () => {
    stubFetch(() => new Response(spotError('No Messages to display')));
    expect(await checkSpot()).toEqual({ feedId: SPOT_ID });
  });

  it.each([
    ['a feed SPOT does not know', () => new Response(spotError('Feed Not Found'))],
    ['a feed turned off', () => new Response(spotError('Feed Currently Not Active'))],
    ['a feed with a password', () => new Response(spotError('Feed Password required'))],
    ['a 404', () => new Response('', { status: 404 })],
  ])('refuses %s, showing the page tried', async (_, answer) => {
    stubFetch(answer);
    const result = await checkSpot();

    expect(result).not.toHaveProperty('feedId');
    expect(result).not.toHaveProperty('failure');
    expect((result as { error: string }).error).toContain(`glId=${SPOT_ID}`);
  });

  it.each([
    ['is down', () => new Response('', { status: 503 }), 'source-error'],
    ['refuses us', () => new Response('', { status: 429 }), 'throttled'],
    ['answers nonsense', () => new Response('<oops'), 'source-error'],
  ])('takes the feed when SPOT %s, and has it logged', async (_, answer, kind) => {
    stubFetch(answer);
    expect(await checkSpot()).toMatchObject({ feedId: SPOT_ID, failure: { kind } });
  });

  it('takes the feed when SPOT cannot be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    expect(await checkSpot()).toMatchObject({ feedId: SPOT_ID, failure: { kind: 'network' } });
  });
});

describe('inReach.checkFeed', () => {
  it('asks once, for the plain feed with no IMEI, to see every device', async () => {
    const { urls } = stubFetch(() => new Response(oneDevice));
    await checkInReach('111');
    expect(urls).toEqual([`https://${ADDRESS}`]);
  });

  it('fills in the IMEI of a feed with one device', async () => {
    stubFetch(() => new Response(oneDevice));
    expect(await checkInReach()).toEqual({ feedId: `${ADDRESS}#111` });
  });

  it('takes the right IMEI of a feed with one device', async () => {
    stubFetch(() => new Response(oneDevice));
    expect(await checkInReach('111')).toEqual({ feedId: `${ADDRESS}#111` });
  });

  it('tells the IMEI of the feed when another was supplied', async () => {
    stubFetch(() => new Response(oneDevice));
    const result = await checkInReach('999');
    expect(result).not.toHaveProperty('feedId');
    expect((result as { error: string }).error).toContain(
      'does not match the one from the feed: 111',
    );
  });

  it('takes an IMEI found in a feed with several devices', async () => {
    stubFetch(() => new Response(twoDevices));
    expect(await checkInReach('111')).toEqual({ feedId: `${ADDRESS}#111` });
  });

  it('asks for an IMEI when the feed has several, the most recent first', async () => {
    stubFetch(() => new Response(twoDevices));
    const { error } = (await checkInReach()) as { error: string };
    expect(error).toContain('more than one IMEI');
    expect(error).toContain('222, 111');
  });

  it('lists them too when the IMEI supplied is not there', async () => {
    stubFetch(() => new Response(twoDevices));
    const { error } = (await checkInReach('999')) as { error: string };
    expect(error).toContain('not present in the feed');
    expect(error).toContain('222, 111');
  });

  it('goes by the newest point of each device', async () => {
    const feed = inReachFeed([
      { time: '2026-01-10T12:00:00Z', imei: '111' },
      { time: '2026-01-09T12:00:00Z', imei: '111' },
      { time: '2026-01-09T18:00:00Z', imei: '222' },
    ]);
    stubFetch(() => new Response(feed));
    expect(((await checkInReach()) as { error: string }).error).toContain('111, 222');
  });

  it('reads the legacy samples', async () => {
    stubFetch(() => new Response(fixture('short-1.kml')));
    expect(await checkInReach()).toHaveProperty('feedId');

    stubFetch(() => new Response(fixture('short-multi-imei.kml')));
    expect(((await checkInReach()) as { error: string }).error).toContain('more than one IMEI');
  });

  it.each([
    ['a feed with no points', () => new Response('<kml />')],
    ['the empty answer Garmin gives for a feed that does not exist', () => new Response('')],
    ['a 404', () => new Response('', { status: 404 })],
  ])('does not recognize %s, and says how to get a feed', async (_, answer) => {
    stubFetch(answer);
    const result = await checkInReach('111');

    expect(result).not.toHaveProperty('failure');
    expect((result as { error: string }).error).toContain('support.garmin.com');
  });

  it.each([
    ['is down', () => new Response('', { status: 503 })],
    ['answers nonsense', () => new Response('<oops')],
  ])('refuses the feed when Garmin %s, and has it logged', async (_, answer) => {
    stubFetch(answer);
    const result = await checkInReach('111');

    expect(result).not.toHaveProperty('feedId');
    expect((result as { error: string }).error).toContain('try again');
    expect(result).toHaveProperty('failure');
  });

  it('does not count a device whose point has no usable time', async () => {
    const feed = inReachFeed([
      { time: 'nonsense', imei: '999' },
      { time: '2026-01-10T12:00:00Z', imei: '111' },
    ]);
    stubFetch(() => new Response(feed));
    expect(await checkInReach()).toEqual({ feedId: `${ADDRESS}#111` });
  });

  it('refuses an address with a query of its own, without asking', async () => {
    const { urls } = stubFetch(() => new Response(oneDevice));
    const result = await inReach.checkFeed(`${ADDRESS}?a=1#111`, open());

    expect(urls).toHaveLength(0);
    expect(result).toHaveProperty('error');
  });
});
