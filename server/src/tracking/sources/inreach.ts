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
import type { FeedError, FeedPoint, FeedResult, HeldTrack, TrackerSource } from './types.ts';

/** The window of the second request: back 48 h and two days more, for Garmin's way with times. */
const WINDOW_DAYS = TRACK_HOURS / 24 + 2;

const FEED_ID =
  /^\s*?(?:(?:[^\s#?&]+\.)?garmin\.com\/(?:[^\s#?&]+\/)*)??(?<id>[^\s#?&/]+)(?:\?[^#]*?)?\s*?(?:#\s*?(?<imei>\d*?))?\s*?$/i;

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

function extendedData(placemark: Placemark): Map<string, string> {
  const data = placemark.ExtendedData?.Data ?? [];
  const items = Array.isArray(data) ? data : [data];
  return new Map(
    items.map((item) => [String(item.name ?? '').trim(), String(item.value ?? '').trim()]),
  );
}

function pointOf(placemark: Placemark, data: Map<string, string>, ts: Date): FeedPoint | null {
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

    const when = placemark.TimeStamp?.when;
    if (!when) continue;
    // Garmin can give different points one time. Oldest come first, so each later one moves on a
    // second, which stays the same from one request to the next:
    let time = new Date(when).getTime();
    if (Number.isNaN(time)) continue;
    while (times.has(time)) time += 1000;

    const point = pointOf(placemark, data, new Date(time));
    if (!point) continue;
    times.add(time);
    points.push(point);
  }
  return points.length > 0 ? points.sort((a, b) => b.ts.getTime() - a.ts.getTime()) : noData();
}

/** Garmin has been seen moving a known point in time: such points stay as they were held. */
function withoutMovedPoints(fresh: FeedPoint[], held: HeldTrack | null): FeedPoint[] {
  const heldTimes = new Map(
    (held ?? []).filter((point) => point.id).map((point) => [point.id, point.ts.getTime()]),
  );
  return fresh.filter((point) => {
    const heldTime = point.id ? heldTimes.get(point.id) : undefined;
    return heldTime === undefined || heldTime === point.ts.getTime();
  });
}

function feedUrl(feedId: string, since?: Date): { url: string } | { error: FeedError } {
  const [address = '', imei = ''] = feedId.replace(/^https?:\/\//i, '').split('#');
  if (address.includes('?')) return { error: sourceError('the feed address has a query part.') };

  const query = new URLSearchParams();
  // The form they take, 2019-01-16T06:19:00z:
  if (since) query.set('d1', `${since.toISOString().slice(0, 19)}z`);
  if (imei.trim()) query.set('imei', imei.trim());
  const text = query.toString().replaceAll('%3A', ':');
  return { url: `https://${address}${text ? `?${text}` : ''}` };
}

const imeiOf = (feedId: string) => (feedId.split('#')[1] ?? '').trim();

/**
 * Two steps: the plain feed gives only the latest point, and when that is the newest one held,
 * nothing has changed. Otherwise a second request asks for the days that are wanted.
 */
async function poll(
  feedId: string,
  held: HeldTrack | null,
  signal: AbortSignal,
  onLatest: (points: FeedPoint[]) => void,
): Promise<FeedResult> {
  const first = feedUrl(feedId);
  if ('error' in first) return { points: [], error: first.error, requestCount: 0 };

  const answer = await fetchFeed(first.url, signal, 'inReach');
  if ('error' in answer) return { points: [], error: answer.error, requestCount: 1 };

  const latest = parseInReachFeed(answer.text, imeiOf(feedId));
  if (!Array.isArray(latest)) return { points: [], error: latest, requestCount: 1 };

  const newest = latest[0]!;
  if (newest.id && newest.id === held?.[0]?.id) return { points: [], error: null, requestCount: 1 };

  onLatest(latest);
  // Not expected, but then there is nothing to go back for:
  const reachedBack = newest.ts.getTime() - latest.at(-1)!.ts.getTime() >= TRACK_HOURS * 3600_000;
  if (reachedBack) return { points: latest, error: null, requestCount: 1 };

  const since = new Date(newest.ts.getTime() - WINDOW_DAYS * 24 * 3600_000);
  const second = feedUrl(feedId, since);
  if ('error' in second) return { points: latest, error: second.error, requestCount: 1 };

  const window = await fetchFeed(second.url, signal, 'inReach');
  if ('error' in window) return { points: latest, error: window.error, requestCount: 2 };

  const fresh = parseInReachFeed(window.text, imeiOf(feedId));
  if (!Array.isArray(fresh)) return { points: latest, error: fresh, requestCount: 2 };

  return { points: withoutMovedPoints(fresh, held), error: null, requestCount: 2 };
}

export const inReach: TrackerSource = {
  type: 'G',
  name: 'inReach',
  // Two requests of 10 s at most, inside the 30 s:
  rules: { startGapMs: 2000, maxInFlight: 10, feedIntervalMs: 30_000, callTimeoutMs: 25_000 },
  poll,
  parseFeedId(text) {
    const match = FEED_ID.exec(text);
    if (!match?.groups?.id)
      return {
        error:
          'We cannot recognize that as a SPOT Shared Page link or ID, or as an inReach feed link.',
      };

    if (!match.groups.imei)
      return {
        error: `An inReach feed needs the device's IMEI after a # sign, e.g.
        ${match.groups.id}#300434031769290.`,
      };

    return { feedId: `share.garmin.com/Feed/Share/${match.groups.id}#${match.groups.imei}` };
  },
};
