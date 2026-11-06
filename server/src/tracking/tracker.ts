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

// What we know about one feed, in memory only (see "Decisions" in AGENTS.md). It lives 20 minutes
// after the last time anybody asked for it.
import { mergeTrack } from './merge.ts';
import type { FeedError, FeedPoint, FeedResult } from './sources/types.ts';

/** Legacy `TrackerLifetimeWithoutAccess`. */
const LIFETIME_WITHOUT_ACCESS_MS = 20 * 60_000;

export class Tracker {
  /** The earliest time the feed may be hit. Decides only a new tracker's place in the queue. */
  dueAt = 0;
  inFlight = false;
  /** The feed interval ended during a call: the end of the call puts it in the queue. */
  dueWhenDone = false;
  /** Past its lifetime. Timers and the queue may still hold it, so they check this. */
  removed = false;

  /**
   * False until the feed has answered anything: the map shows "wait". Not the same as having no
   * position: a feed that answered with an error has none either, and the map shows the error.
   */
  answered = false;
  latest: FeedPoint | null = null;
  previous: FeedPoint | null = null;
  error: FeedError | null = null;
  /** Newest first; null until a whole first fetch is done, so the client never gets half of it. */
  track: FeedPoint[] | null = null;

  /** For the admin's list only (times in ms): nothing decides by them. */
  readonly createdAt = Date.now();
  /** The last request for this feed from a map. */
  accessedAt = Date.now();
  /** The end of the last call, whatever came of it. */
  refreshedAt: number | null = null;

  private removeTimer: NodeJS.Timeout | undefined;

  constructor(
    /** `S:<feedId>` or `G:<feedId>`: its place in the map, and what names it in the log. */
    readonly key: string,
    readonly feedId: string,
    private readonly onRemove: () => void,
  ) {}

  /** Every request for this feed puts its end off: nobody watching means no more polling. */
  resetRemovingTimer(): void {
    this.accessedAt = Date.now();
    clearTimeout(this.removeTimer);
    this.removeTimer = setTimeout(() => {
      this.removed = true;
      this.onRemove();
    }, LIFETIME_WITHOUT_ACCESS_MS);
    // A pending removal is no reason to keep the process alive:
    this.removeTimer.unref();
  }

  /** The first response of a call: the map can show the position while the track is still coming. */
  applyLatest(points: FeedPoint[]): void {
    // Merged only to find the two newest points; the track itself waits for the end of the call:
    const [latest, previous] = mergeTrack(this.track ?? [], points);
    this.answered = true;
    if (latest) {
      this.latest = latest;
      this.previous = previous ?? null;
    }
  }

  /** The end of a call. An error keeps the position held: the map shows both. */
  applyResult(result: FeedResult): void {
    this.answered = true;
    // Also clears an old error, when a call went well, even with nothing new:
    this.error = result.error;
    // A first fetch that failed half way starts again next time, with no track until it is whole:
    if (result.error && this.track === null) return;
    const track = mergeTrack(this.track ?? [], result.points);
    // Nothing held and nothing new, so the position set by `applyLatest` stays:
    if (track.length === 0) return;
    this.track = track;
    this.latest = track[0]!;
    this.previous = track[1] ?? null;
  }
}
