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

// SPOT's public XML feed. Its published rules: 2.5 minutes between calls of one feed, 2 seconds
// between requests. A page holds at most 50 messages.
import { XMLParser } from 'fast-xml-parser';
import { mergeTrack, TRACK_HOURS } from '../merge.ts';
import { badFeedId, fetchFeed, findAll, noData, sourceError } from './http.ts';
import type {
  FeedCheck,
  FeedError,
  FeedPoint,
  FeedResult,
  HeldTrack,
  TrackerSource,
} from './types.ts';

const FEED_URL = 'https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed';
const PAGE_SIZE = 50;
/** Legacy's limit (`Iteration < 5`): 300 messages at most on a first fetch. */
const MAX_PAGES = 6;

const FEED_ID =
  /^\s*?(?:(?:(?:http|https):\/\/)??share\.findmespot\.com\/shared\/faces\/viewspots\.jsp\?glId=)??([^\s\\/?=&#]{20,50})\s*?$/i;

// The script shows as SOS anything but TRACK, OK, TEST and CUSTOM, so the many statuses of SPOT
// become one of those:
const TYPES: Record<string, string> = {
  TEST: 'OK',
  STOP: 'OK',
  'HELP-CANCEL': 'OK',
  'EXTREME-TRACK': 'TRACK',
  'UNLIMITED-TRACK': 'TRACK',
  NEWMOVEMENT: 'TRACK',
  POI: 'TRACK',
};

// Every value stays text: `pointOf` converts what it needs, and an id must not turn into a number.
const parser = new XMLParser({ parseTagValue: false, ignoreAttributes: true });

interface Message {
  id?: string;
  latitude?: string;
  longitude?: string;
  altitude?: string;
  messageType?: string;
  dateTime?: string;
  unixTime?: string;
  messageContent?: string;
}

function timeOf(message: Message): Date | null {
  // Comes as 2013-01-10T11:03:36+0000, where the standard wants +00:00:
  const text = message.dateTime?.replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
  const date = text ? new Date(text) : new Date(Number(message.unixTime) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pointOf(message: Message): FeedPoint | null {
  const lat = Number(message.latitude ?? NaN);
  const lon = Number(message.longitude ?? NaN);
  const ts = timeOf(message);
  const type = message.messageType;
  if (Number.isNaN(lat) || Number.isNaN(lon) || !ts || !type) return null;

  const alt = Math.trunc(Number(message.altitude ?? 0)) || undefined;
  return {
    id: message.id,
    lat,
    lon,
    alt: alt === undefined ? undefined : Math.max(0, alt),
    ts,
    type: TYPES[type] ?? type,
    userMessage: message.messageContent?.trim() || undefined,
  };
}

/** SPOT reports these inside a normal answer, as text in an `error` element. */
function errorOf(text: string, feedId: string): FeedError {
  if (text.includes('No Messages to display')) return noData();
  if (/Feed Not Found|Feed Currently Not Active|Feed Password required/.test(text))
    return badFeedId('SPOT');
  // Nobody knows what this one means, so it is taken for "no data" and logged:
  return { ...noData(), detail: text.replaceAll(feedId, '<feed>') };
}

/** One page of the feed: all its points newest first, or why there are none. `merge.ts` decides what is kept. */
export function parseSpotPage(xml: string, feedId: string): FeedPoint[] | FeedError {
  let document: unknown;
  try {
    // `true` checks the XML first: a broken answer throws instead of giving half a document.
    document = parser.parse(xml, true);
  } catch (err) {
    return sourceError((err as Error).message);
  }
  const [error] = findAll(document, 'error') as { text?: string }[];
  if (error) return errorOf(String(error.text ?? ''), feedId);

  const messages = findAll(document, 'message') as Message[];
  const points = messages
    .map(pointOf)
    .filter((point) => point !== null)
    .sort((a, b) => b.ts.getTime() - a.ts.getTime());
  if (points.length > 0) return points;
  // Messages but no usable point: their format must have changed.
  return messages.length > 0
    ? { kind: 'source-error', userMessage: 'Inconsistent SPOT server response schema.' }
    : noData();
}

/** `start` counts messages from 1: the second page is `?start=51`. */
const pageUrl = (feedId: string, page: number) =>
  `${FEED_URL}/${feedId}/message.xml${page === 0 ? '' : `?start=${page * PAGE_SIZE + 1}`}`;

/**
 * A feed's first fetch reads back through the pages, one right after the other, as long as they come
 * full and do not yet span 48 h. After that the top page is enough: it reaches past what is held.
 */
async function poll(
  feedId: string,
  held: HeldTrack | null,
  signal: AbortSignal,
  onLatest: (points: FeedPoint[]) => void,
): Promise<FeedResult> {
  let points: FeedPoint[] = [];
  for (let page = 0; ; page++) {
    const requestCount = page + 1;
    const answer = await fetchFeed(pageUrl(feedId, page), signal, 'SPOT');
    // Only a first fetch gets past page one, and `Tracker` drops these points if it fails:
    if ('error' in answer) return { points, error: answer.error, requestCount };

    const fresh = parseSpotPage(answer.text, feedId);
    if (!Array.isArray(fresh)) {
      // Running out of messages on a later page is simply the end of them:
      const ended = page > 0 && fresh.kind === 'no-data';
      return { points, error: ended ? null : fresh, requestCount };
    }
    points = mergeTrack(points, fresh);
    // The marker need not wait for the rest of the chain:
    if (page === 0) onLatest(points);

    // Measured to the page, not to `points`: those are trimmed, so they never span the 48 h.
    const spanMs = points[0]!.ts.getTime() - fresh.at(-1)!.ts.getTime();

    const isLast =
      held !== null ||
      fresh.length < PAGE_SIZE ||
      spanMs >= TRACK_HOURS * 3600_000 ||
      requestCount >= MAX_PAGES;
    if (isLast) return { points, error: null, requestCount };
  }
}

/** Only a definite "no such feed" refuses it: SPOT being down or the feed being empty says nothing. */
async function checkFeed(feedId: string, signal: AbortSignal): Promise<FeedCheck> {
  const answer = await fetchFeed(pageUrl(feedId, 0), signal, 'SPOT');
  const page = 'error' in answer ? answer.error : parseSpotPage(answer.text, feedId);
  if (Array.isArray(page) || page.kind === 'no-data') return { feedId };
  if (page.kind !== 'bad-feed-id') return { feedId, failure: page };
  return {
    error: `We cannot recognize the SPOT Shared Page ID you've passed. Our best guess for the Shared
      Page was https://share.findmespot.com/shared/faces/viewspots.jsp?glId=${feedId}, but it didn't
      work.`,
  };
}

export const spot: TrackerSource = {
  type: 'S',
  name: 'SPOT',
  rules: { startGapMs: 2000, maxInFlight: 10, feedIntervalMs: 150_000, callTimeoutMs: 60_000 },
  poll,
  checkFeed,
  parseFeedId(text) {
    const match = FEED_ID.exec(text);
    return match
      ? { feedId: match[1]! }
      : {
          error:
            'That does not look like a SPOT Shared Page link or ID (20 to 50 letters and digits).',
        };
  },
};
