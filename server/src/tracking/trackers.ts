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

// What we know about the feeds being watched, in memory only (see "Decisions" in AGENTS.md): the map
// of `Tracker`s, shared by all sources, and the single-process guard. A feed gets a `Tracker` when a
// map first asks for it, and loses it 20 minutes after the last time anybody asked.
import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';
import type { Pool } from '../db.ts';
import { mergeTrack } from './merge.ts';
import { Pipeline } from './pipeline.ts';
import { sources } from './sources/index.ts';
import type {
  FeedError,
  FeedPoint,
  FeedResult,
  SourceType,
  TrackerSource,
} from './sources/types.ts';

/** Legacy `TrackerLifetimeWithoutAccess`. */
const LIFETIME_WITHOUT_ACCESS_MS = 20 * 60_000;

/** Any fixed number: only one process may hold it, see "Exactly one app process" in AGENTS.md. */
const POLLING_LOCK = 7_316_001;

const keyOf = (type: SourceType, feedId: string) => `${type}:${feedId}`;

export class Tracker {
  /** The earliest time the feed may be hit. */
  dueAt = 0;
  inFlight = false;
  /** The feed interval ended during a call: the end of the call puts it in the queue. */
  dueWhenDone = false;
  removed = false;

  /** False until the feed has answered anything: the map shows "wait". */
  answered = false;
  latest: FeedPoint | null = null;
  previous: FeedPoint | null = null;
  error: FeedError | null = null;
  /** Newest first; null until a whole first fetch is done, so the client never gets half of it. */
  track: FeedPoint[] | null = null;

  private removeTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly feedId: string,
    private readonly onRemove: () => void,
  ) {}

  resetRemovingTimer(): void {
    clearTimeout(this.removeTimer);
    this.removeTimer = setTimeout(() => {
      this.removed = true;
      this.onRemove();
    }, LIFETIME_WITHOUT_ACCESS_MS);
    this.removeTimer.unref();
  }

  /** The first response of a call: the map can show the position while the track is still coming. */
  applyLatest(points: FeedPoint[]): void {
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
    this.error = result.error;
    // A first fetch that failed half way starts again next time, with no track until it is whole:
    if (result.error && this.track === null) return;
    const track = mergeTrack(this.track ?? [], result.points);
    if (track.length === 0) return;
    this.track = track;
    this.latest = track[0]!;
    this.previous = track[1] ?? null;
  }
}

export class Tracking {
  private readonly trackers = new Map<string, Tracker>();
  /** When each feed was last called, from `feed_polls`: a restart must not hit a feed too soon. */
  private readonly lastPolled = new Map<string, number>();
  private readonly shutdown = new AbortController();
  private readonly pipelines: Record<SourceType, Pipeline>;
  private lockClient: pg.Client | undefined;
  private polling = false;

  constructor(
    private readonly pool: Pool,
    private readonly log: FastifyBaseLogger,
    private readonly databaseUrl: string,
  ) {
    const pipelineOf = (source: TrackerSource) =>
      new Pipeline(source, log, this.shutdown.signal, (tracker, now) =>
        this.remember(source, tracker, now),
      );
    this.pipelines = { S: pipelineOf(sources.S), G: pipelineOf(sources.G) };
  }

  /** Called once by the real server. Until then, and in tests, every tracker stays "wait". */
  async start(): Promise<void> {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    await client.connect();
    const { rows } = await client.query<{ got: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS got',
      [POLLING_LOCK],
    );
    if (!rows[0]?.got) {
      await client.end();
      this.log.error('Another process is polling the trackers: this one will not');
      return;
    }
    client.on('error', (err) => this.log.error(err, 'The polling lock connection failed'));
    this.lockClient = client;

    const polls = await this.pool.query<{
      tracker_type: SourceType;
      foreign_id: string;
      last_polled_at: Date;
    }>('SELECT tracker_type, foreign_id, last_polled_at FROM feed_polls');
    for (const row of polls.rows)
      this.lastPolled.set(keyOf(row.tracker_type, row.foreign_id), row.last_polled_at.getTime());

    this.pipelines.S.start();
    this.pipelines.G.start();
    this.polling = true;
  }

  async stop(): Promise<void> {
    this.polling = false;
    this.pipelines.S.stop();
    this.pipelines.G.stop();
    this.shutdown.abort();
    await this.lockClient?.end();
  }

  /**
   * The trackers of these feeds, in that order, each with its removal put off. Feeds not known yet
   * get a new tracker, which answers "wait" for now, and join the queue of their source.
   */
  access(feeds: readonly { type: SourceType; feedId: string }[]): Tracker[] {
    const fresh: Record<SourceType, Tracker[]> = { S: [], G: [] };
    const trackers = feeds.map(({ type, feedId }) => {
      const key = keyOf(type, feedId);
      let tracker = this.trackers.get(key);
      if (!tracker) {
        tracker = new Tracker(feedId, () => this.trackers.delete(key));
        if (!this.polling) return tracker;

        const last = this.lastPolled.get(key) ?? 0;
        tracker.dueAt = last === 0 ? 0 : last + sources[type].rules.feedIntervalMs;
        this.trackers.set(key, tracker);
        fresh[type].push(tracker);
      }
      tracker.resetRemovingTimer();
      return tracker;
    });
    this.pipelines.S.add(fresh.S);
    this.pipelines.G.add(fresh.G);
    return trackers;
  }

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
