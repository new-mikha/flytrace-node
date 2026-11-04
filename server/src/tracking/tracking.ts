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

// The feeds being watched: the map of `Tracker`s, shared by all sources, and the single-process
// guard. A feed gets a `Tracker` when a map first asks for it.
import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';
import type { Pool } from '../db.ts';
import { Pipeline } from './pipeline.ts';
import { sources } from './sources/index.ts';
import type { SourceType, TrackerSource } from './sources/types.ts';
import { Tracker } from './tracker.ts';

/**
 * The name of a Postgres advisory lock: a lock on nothing but this number, which our code agrees to
 * respect. Any fixed number will do. Two processes polling would hit every feed twice and answer
 * differently, see "Exactly one app process" in AGENTS.md.
 */
const POLLING_LOCK = 7_316_001;

/** By the feed, not by a group's row: a feed in several groups is one tracker, polled once. */
const keyOf = (type: SourceType, feedId: string) => `${type}:${feedId}`;

export class Tracking {
  private readonly trackers = new Map<string, Tracker>();
  /** When each feed was last called, from `feed_polls`: a restart must not hit a feed too soon. */
  private readonly lastPolled = new Map<string, number>();
  /** Aborted by `stop()`: it ends the calls in flight, so closing the app does not wait for feeds. */
  private readonly shutdown = new AbortController();
  private readonly pipelines = new Map<SourceType, Pipeline>();
  /** Holds the polling lock simply by staying connected. */
  private lockClient: pg.Client | undefined;
  /** True once this process holds the lock and the pipelines run. */
  private polling = false;

  constructor(
    private readonly pool: Pool,
    private readonly log: FastifyBaseLogger,
    private readonly databaseUrl: string,
  ) {
    for (const source of Object.values(sources))
      this.pipelines.set(
        source.type,
        new Pipeline(source, log, this.shutdown.signal, (tracker, now) =>
          this.remember(source, tracker, now),
        ),
      );
  }

  /** Called once by the real server. Until then, and in tests, every tracker stays "wait". */
  async start(): Promise<void> {
    // The lock belongs to a database connection, and Postgres frees it when that connection ends,
    // even if this process crashes, so nothing stale is left behind. That is why it takes a
    // connection of its own: the pool's connections are shared and come and go.
    const client = new pg.Client({ connectionString: this.databaseUrl });
    await client.connect();
    // The "try" form answers at once, true or false, where pg_advisory_lock would wait for the lock:
    const { rows } = await client.query<{ got: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS got',
      [POLLING_LOCK],
    );
    if (!rows[0]?.got) {
      await client.end();
      this.log.error('Another process is polling the trackers: this one will not');
      return;
    }
    // Without a listener a dropped connection would bring the whole app down. The lock goes with the
    // connection, but polling carries on: that only matters if a second process starts just then.
    client.on('error', (err) => this.log.error(err, 'The polling lock connection failed'));
    this.lockClient = client;

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

  async stop(): Promise<void> {
    this.polling = false;
    // First no new calls, then the end of those running:
    for (const pipeline of this.pipelines.values()) pipeline.stop();
    this.shutdown.abort();
    await this.lockClient?.end();
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
        tracker = new Tracker(feedId, () => this.trackers.delete(key));
        // Nobody will ever fill it (tests, or another process holds the lock): a throwaway "wait",
        // kept out of the map so that it needs no removal:
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
   * Notes that a call of this feed is starting. The call does not wait for the database, and a
   * failed write costs little: at worst one early hit on the feed after a restart.
   */
  private remember(source: TrackerSource, tracker: Tracker, now: number): void {
    this.lastPolled.set(keyOf(source.type, tracker.feedId), now);
    this.pool
      .query(
        `INSERT INTO feed_polls (tracker_type, foreign_id, last_polled_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0))
         ON CONFLICT (tracker_type, foreign_id) DO UPDATE SET last_polled_at = EXCLUDED.last_polled_at`,
        [source.type, tracker.feedId, now],
      )
      .catch((err: unknown) => this.log.error(err, 'Could not save the time of a poll'));
  }
}
