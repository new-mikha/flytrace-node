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

// Garmin inReach's MapShare KML feed. Garmin publishes no limits; the 30 seconds are the legacy number.
import { XMLParser } from 'fast-xml-parser';
import { TRACK_HOURS } from '../merge.ts';
import { fetchFeed, findAll, noData, sourceError } from './http.ts';
import type {
  FeedCheck,
  FeedError,
  FeedPoint,
  FeedResult,
  HeldTrack,
  TrackerSource,
} from './types.ts';

/** How far back `d1` goes: 48 h and two days more, for Garmin's way with times. */
const WINDOW_DAYS = TRACK_HOURS / 24 + 2;

const FEED_ID =
  /^\s*?(?:(?:[^\s#?&]+\.)?garmin\.com\/(?:[^\s#?&]+\/)*)??(?<id>[^\s#?&/]+)(?:\?[^#]*?)?\s*?(?:#\s*?(?<imei>\d*?))?\s*?$/i;

// Every value stays text. Attributes are needed: the fields are <Data name="IMEI">, so the name of
// each is in an attribute, and an empty prefix lets `extendedData` read it as `item.name`.
const parser = new XMLParser({
  parseTagValue: false,
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

interface Placemark {
  TimeStamp?: { when?: string };
  Point?: { coordinates?: string };
  ExtendedData?: { Data?: DataItem | DataItem[] };
}

interface DataItem {
  name?: string;
  value?: unknown;
}

/** A placemark's `<ExtendedData>` fields by name. A single one parses as an object, not a list. */
function extendedData(placemark: Placemark): Map<string, string> {
  const data = placemark.ExtendedData?.Data ?? [];
  const items = Array.isArray(data) ? data : [data];
  return new Map(
    items.map((item) => [String(item.name ?? '').trim(), String(item.value ?? '').trim()]),
  );
}

function pointOf(placemark: Placemark, data: Map<string, string>, ts: Date): FeedPoint | null {
  // KML's order, longitude first:
  const [lon, lat, alt] = String(placemark.Point?.coordinates ?? '')
    .split(',')
    .map(Number);
  if (lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const userMessage = data.get('Text') || undefined;
  const inEmergency = data.get('In Emergency')?.toLowerCase() === 'true';
  return {
    id: data.get('Id') || undefined,
    lat,
    lon,
    alt: alt === undefined || Number.isNaN(alt) ? undefined : Math.trunc(alt),
    ts,
    type: inEmergency ? 'SOS' : userMessage ? 'OK' : 'TRACK',
    userMessage,
  };
}

/**
 * The points of a feed document, newest first, or why there are none. A feed can carry several
 * devices: `imei` picks one, and without it the feed must hold a single one.
 */
export function parseInReachFeed(kml: string, imei: string): FeedPoint[] | FeedError {
  let document: unknown;
  try {
    document = parser.parse(kml, true);
  } catch (err) {
    return sourceError((err as Error).message);
  }
  const points: FeedPoint[] = [];
  const times = new Set<number>();
  let onlyImei = imei;
  for (const placemark of findAll(document, 'Placemark') as Placemark[]) {
    const data = extendedData(placemark);
    const pointImei = data.get('IMEI');
    if (pointImei && !imei) {
      if (onlyImei && pointImei !== onlyImei)
        return sourceError(
          "the feed holds several devices. Add the device's IMEI after a # sign to the tracker.",
        );
      onlyImei = pointImei;
    }
    if (pointImei && imei && pointImei !== imei) continue;

    // Garmin can give different points one time. Oldest come first, so each later one moves on a
    // second, which stays the same from one request to the next:
    let time = new Date(placemark.TimeStamp?.when ?? NaN).getTime();
    if (Number.isNaN(time)) continue;
    while (times.has(time)) time += 1000;

    const point = pointOf(placemark, data, new Date(time));
    if (!point) continue;
    times.add(time);
    points.push(point);
  }
  return points.length > 0 ? points.sort((a, b) => b.ts.getTime() - a.ts.getTime()) : noData();
}

/**
 * Garmin has been seen moving a known point in time: such points stay as they were held. An `Id` used
 * twice in the held track means ids cannot be trusted, so then nothing is dropped, as in legacy.
 */
function withoutMovedPoints(
  fresh: FeedPoint[],
  held: HeldTrack,
): { points: FeedPoint[]; warnings: string[] } {
  const heldTimes = new Map<string, number>();
  for (const { id, ts } of held) {
    if (!id) continue;
    if (heldTimes.has(id))
      return {
        points: fresh,
        warnings: ['the same Id is on two points, moved points not checked'],
      };
    heldTimes.set(id, ts.getTime());
  }

  const points = fresh.filter((point) => {
    const heldTime = point.id ? heldTimes.get(point.id) : undefined;
    return heldTime === undefined || heldTime === point.ts.getTime();
  });
  const moved = fresh.length - points.length;
  return { points, warnings: moved > 0 ? [`${moved} known point(s) moved in time, ignored`] : [] };
}

function feedUrl(feedId: string, since?: Date): { url: string } | { error: FeedError } {
  const [address = '', imei = ''] = feedId.replace(/^https?:\/\//i, '').split('#');
  // Ours is added below, so the stored address must not bring one of its own:
  if (address.includes('?')) return { error: sourceError('the feed address has a query part.') };

  const query = new URLSearchParams();
  // The form they take, 2019-01-16T06:19:00z:
  if (since) query.set('d1', `${since.toISOString().slice(0, 19)}z`);
  if (imei.trim()) query.set('imei', imei.trim());
  // URLSearchParams encodes the colons of the time; legacy sent them as they are, so we do too:
  const text = query.toString().replaceAll('%3A', ':');
  return { url: `https://${address}${text ? `?${text}` : ''}` };
}

const imeiOf = (feedId: string) => (feedId.split('#')[1] ?? '').trim();

const windowStart = (newest: FeedPoint) =>
  new Date(newest.ts.getTime() - WINDOW_DAYS * 24 * 3600_000);

async function fetchPoints(
  feedId: string,
  signal: AbortSignal,
  since?: Date,
): Promise<FeedPoint[] | FeedError> {
  const target = feedUrl(feedId, since);
  if ('error' in target) return target.error;

  const answer = await fetchFeed(target.url, signal, 'inReach');
  if ('error' in answer) return answer.error;

  return parseInReachFeed(answer.text, imeiOf(feedId));
}

/**
 * With a track held, one request for the whole window: every new point comes at once, so the marker
 * and the track never disagree. The first fetch has no time to go back from, so the plain feed
 * gives the latest point first, and a second request the days before it.
 */
async function poll(
  feedId: string,
  held: HeldTrack | null,
  signal: AbortSignal,
  onLatest: (points: FeedPoint[]) => void,
): Promise<FeedResult> {
  const newestHeld = held?.[0];
  if (held && newestHeld) {
    const fresh = await fetchPoints(feedId, signal, windowStart(newestHeld));
    if (!Array.isArray(fresh)) return { points: [], error: fresh, requestCount: 1 };

    // Without an `Id` we cannot tell, so it goes on to the merge, which keeps what is held:
    const newest = fresh[0]!;
    if (newest.id && newest.id === newestHeld.id)
      return { points: [], error: null, requestCount: 1 };

    return { ...withoutMovedPoints(fresh, held), error: null, requestCount: 1 };
  }

  const latest = await fetchPoints(feedId, signal);
  if (!Array.isArray(latest)) return { points: [], error: latest, requestCount: 1 };

  // The marker need not wait for the window:
  onLatest(latest);
  const newest = latest[0]!;
  // Not expected, but then there is nothing to go back for:
  const reachedBack = newest.ts.getTime() - latest.at(-1)!.ts.getTime() >= TRACK_HOURS * 3600_000;
  if (reachedBack) return { points: latest, error: null, requestCount: 1 };

  const fresh = await fetchPoints(feedId, signal, windowStart(newest));
  // `Tracker` drops these points on a first fetch that failed, and the next call starts over:
  if (!Array.isArray(fresh)) return { points: latest, error: fresh, requestCount: 2 };

  return { points: fresh, error: null, requestCount: 2 };
}

/** The devices of a feed document with the time of the newest point of each, or why there are none. */
function devicesOf(kml: string): Map<string, number> | FeedError {
  let document: unknown;
  try {
    document = parser.parse(kml, true);
  } catch (err) {
    return sourceError((err as Error).message);
  }
  const devices = new Map<string, number>();
  for (const placemark of findAll(document, 'Placemark') as Placemark[]) {
    const imei = extendedData(placemark).get('IMEI');
    const time = new Date(placemark.TimeStamp?.when ?? NaN).getTime();
    if (imei && !Number.isNaN(time)) devices.set(imei, Math.max(time, devices.get(imei) ?? 0));
  }
  return devices;
}

const NOT_RECOGNIZED = `We cannot recognize the inReach link you supplied. First, double check what
  you have entered: it should look similar to https://share.garmin.com/Feed/Share/your-feed-name.
  Then, Garmin explains how to prepare a KML feed:
  https://support.garmin.com/en-AU/?faq=tdlDCyo1fJ5UxjUbA9rMY8`;

/**
 * The plain feed holds the latest point of every device, so this also finds the IMEI, which most
 * people leave out: with one device it is simply that one's. Unlike SPOT, a feed that cannot be
 * read is refused, because the IMEI may be missing from what gets stored.
 */
async function checkFeed(feedId: string, signal: AbortSignal): Promise<FeedCheck> {
  const [address = ''] = feedId.split('#');
  const imei = imeiOf(feedId);
  const target = feedUrl(address);
  if ('error' in target) return { error: NOT_RECOGNIZED };

  const answer = await fetchFeed(target.url, signal, 'inReach');
  const devices = 'error' in answer ? answer.error : devicesOf(answer.text);
  if (!(devices instanceof Map)) {
    if (devices.kind === 'bad-feed-id') return { error: NOT_RECOGNIZED };
    return {
      error: 'We could not get an answer from Garmin to check this feed. Please try again.',
      failure: devices,
    };
  }
  if (devices.size === 0) return { error: NOT_RECOGNIZED };

  if (devices.size === 1) {
    const [only = ''] = devices.keys();
    if (!imei || imei === only) return { feedId: `${address}#${only}` };
    return {
      error: `The link is correct, however the supplied IMEI does not match the one from the feed: ${only}.`,
    };
  }
  if (devices.has(imei)) return { feedId };

  const newestFirst = [...devices].sort((a, b) => b[1] - a[1]).map(([device]) => device);
  const list = newestFirst.join(', ');
  return {
    error: imei
      ? `The link is correct, however the supplied IMEI is not present in the feed. If you would like to go with this link, add one of the following after the # sign: ${list}.`
      : `The link is correct, however there is more than one IMEI in the feed. Please add one of them after a # sign to the link: ${list}.`,
  };
}

export const inReach: TrackerSource = {
  type: 'G',
  name: 'inReach',
  // A first fetch is two requests of 10 s at most, inside the 30 s:
  rules: { startGapMs: 2000, maxInFlight: 10, feedIntervalMs: 30_000, callTimeoutMs: 25_000 },
  poll,
  checkFeed,
  parseFeedId(text) {
    const match = FEED_ID.exec(text);
    if (!match?.groups?.id)
      return {
        error:
          'We cannot recognize that as a SPOT Shared Page link or ID, or as an inReach feed link.',
      };

    // Without the IMEI for now: `checkFeed` finds it.
    return { feedId: `share.garmin.com/Feed/Share/${match.groups.id}#${match.groups.imei ?? ''}` };
  },
};
