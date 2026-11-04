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

// What a tracker source is: the one interface the polling knows. Everything particular to SPOT or
// inReach (addresses, feed formats, paging, their timing numbers) stays behind it.

export type SourceType = 'S' | 'G';

/** One position from a feed. */
export interface FeedPoint {
  /** The source's own id of the message, when it has one. */
  id?: string;
  lat: number;
  lon: number;
  /** Metres. */
  alt?: number;
  ts: Date;
  /** `TRACK`, `OK`, `CUSTOM`, `HELP`, `SOS`, ...: what the map script expects. */
  type: string;
  userMessage?: string;
}

/** The track held for a feed, newest first. */
export type HeldTrack = readonly FeedPoint[];

export type FeedErrorKind =
  'bad-feed-id' | 'no-data' | 'throttled' | 'unauthorized' | 'timeout' | 'source-error' | 'network';

export interface FeedError {
  kind: FeedErrorKind;
  /** Shown on the map, so it never holds the feed id. */
  userMessage: string;
  /** More about it for the log; no feed ids here either. */
  detail?: string;
  status?: number;
  headers?: Record<string, string>;
  retryAfterMs?: number;
}

/** What one call brought. Both `points` and `error` can be there: a later page may have failed. */
export interface FeedResult {
  /** Newest first. */
  points: FeedPoint[];
  error: FeedError | null;
  requestCount: number;
}

export interface TrackerSource {
  readonly type: SourceType;
  readonly name: string;
  readonly rules: {
    /** Between two request starts of this source. */
    startGapMs: number;
    maxInFlight: number;
    /** Between two calls of one feed, from the start of the last one. */
    feedIntervalMs: number;
    /** A whole call, all its pages or iterations. Must be shorter than `feedIntervalMs`. */
    callTimeoutMs: number;
  };
  /**
   * One call: as many requests as the source needs. `held` is the track already held, null on a
   * feed's first fetch. `onLatest` gets the points of the first response, before the call ends.
   * Rejects only when `signal` was aborted by the shutdown; everything else is a `FeedError`.
   */
  poll(
    feedId: string,
    held: HeldTrack | null,
    signal: AbortSignal,
    onLatest: (points: FeedPoint[]) => void,
  ): Promise<FeedResult>;
  parseFeedId(text: string): { feedId: string } | { error: string };
}
