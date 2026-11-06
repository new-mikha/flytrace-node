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

// The feeds being watched: the map of `Tracker`s, shared by all sources. A feed gets a `Tracker` when
// a map first asks for it.
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from '../db.ts';
import { Pipeline } from './pipeline.ts';
import { sources } from './sources/index.ts';
import type { SourceType, TrackerSource } from './sources/types.ts';
import { Tracker } from './tracker.ts';

/** By the feed, not by a group's row: a feed in several groups is one tracker, polled once. */
export const keyOf = (type: SourceType, feedId: string) => `${type}:${feedId}`;

export class Tracking {
  private readonly trackers = new Map<string, Tracker>();
  /** When each feed was last called, from `feed_polls`: a restart must not hit a feed too soon. */
  private readonly lastPolled = new Map<string, number>();
  /** Aborted by `stop()`: it ends the calls in flight, so closing the app does not wait for feeds. */
  private readonly shutdownController = new AbortController();
  private readonly pipelines = new Map<SourceType, Pipeline>();
  /** True once the pipelines run. */
  private polling = false;

  constructor(
    private readonly pool: Pool,
    private readonly log: FastifyBaseLogger,
  ) {
    for (const source of Object.values(sources))
      this.pipelines.set(
        source.type,
        new Pipeline(source, log, this.shutdownController.signal, (tracker, now) =>
          this.remember(source, tracker, now),
        ),
      );
  }

  /** Called once by the real server. Until then, and in tests, every tracker stays "wait". */
  async start(): Promise<void> {
    // A row only matters until its feed's interval is over, so an hour is plenty. Done here, once, on
    // a small table, so `last_polled_at` needs no index (it would slow the write of every poll):
    await this.pool.query(
      `DELETE FROM feed_polls WHERE last_polled_at < now() - interval '1 hour'`,
    );

    // Read only here: from now on `remember` keeps the map up to date itself.
    const polls = await this.pool.query<{
      tracker_type: SourceType;
      foreign_id: string;
      last_polled_at: Date;
    }>('SELECT tracker_type, foreign_id, last_polled_at FROM feed_polls');
    for (const row of polls.rows)
      this.lastPolled.set(keyOf(row.tracker_type, row.foreign_id), row.last_polled_at.getTime());

    for (const pipeline of this.pipelines.values()) pipeline.start();
    this.polling = true;
  }

  stop(): void {
    this.polling = false;
    // First no new calls, then the end of those running:
    for (const pipeline of this.pipelines.values()) pipeline.stop();
    this.shutdownController.abort();
  }

  /**
   * The trackers of these feeds, in that order, each with its removal put off. Feeds not known yet
   * get a new tracker, which answers "wait" for now, and join the queue of their source.
   */
  access(feeds: readonly { type: SourceType; feedId: string }[]): Tracker[] {
    // Gathered by source, so that a pipeline gets all the new trackers of this request at once:
    const fresh = new Map<SourceType, Tracker[]>();
    const trackers = feeds.map(({ type, feedId }) => {
      const key = keyOf(type, feedId);
      let tracker = this.trackers.get(key);
      if (!tracker) {
        tracker = new Tracker(key, feedId, () => this.trackers.delete(key));
        // Nobody will ever fill it (tests): a throwaway "wait", kept out of the map so that it needs
        // no removal:
        if (!this.polling) return tracker;

        // Also covers a tracker removed and asked for again soon after, not only a restart:
        const last = this.lastPolled.get(key) ?? 0;
        tracker.dueAt = last === 0 ? 0 : last + sources[type].rules.feedIntervalMs;
        this.trackers.set(key, tracker);
        fresh.set(type, [...(fresh.get(type) ?? []), tracker]);
      }
      tracker.resetRemovingTimer();
      return tracker;
    });
    for (const [type, added] of fresh) this.pipelines.get(type)!.add(added);
    return trackers;
  }

  /**
   * Every tracker held now, for the admin's list. Nothing else goes through the whole map: each
   * tracker is driven by its own timers.
   */
  list(): Tracker[] {
    return [...this.trackers.values()];
  }

  /**
   * Notes that a call of this feed is starting. The call does not wait for the database, and a
   * failed write costs little: at worst one early hit on the feed after a restart.
   */
  private remember(source: TrackerSource, tracker: Tracker, now: number): void {
    this.lastPolled.set(tracker.key, now);
    this.pool
      .query(
        `INSERT INTO feed_polls (tracker_type, foreign_id, last_polled_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0))
         ON CONFLICT (tracker_type, foreign_id) DO UPDATE SET last_polled_at = EXCLUDED.last_polled_at`,
        [source.type, tracker.feedId, now],
      )
      .catch((err: unknown) => this.log.warn(err, 'Could not save the time of a poll'));
  }
}
