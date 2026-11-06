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

// One source's timeline: its queue, its loop at the source's start gap, its calls in flight. Sources
// run side by side and know nothing of each other.
import type { FastifyBaseLogger } from 'fastify';
import type { TrackerSource } from './sources/types.ts';
import type { Tracker } from './tracker.ts';

export class Pipeline {
  /** Only trackers that are due, so the head is simply the one waiting longest. */
  private readonly queue: Tracker[] = [];
  /** Calls running now, for all the feeds of this source. */
  private inFlight = 0;
  /** A poll has thrown since the start: ERROR goes to email one day, so only the first is one. */
  private threw = false;
  private loop: NodeJS.Timeout | undefined;

  constructor(
    private readonly source: TrackerSource,
    private readonly log: FastifyBaseLogger,
    private readonly shutdownSignal: AbortSignal,
    /** Called as a call starts, with the time to remember for the feed. */
    private readonly onCallStart: (tracker: Tracker, now: number) => void,
  ) {
    // Every call must be over before its feed is due again, or it would be hit twice at once.
    // `onIntervalOver` still copes if that ever happens, but it should not:
    const { callTimeoutMs, feedIntervalMs } = source.rules;
    if (callTimeoutMs >= feedIntervalMs)
      throw new Error(`${source.name}: a call may not last as long as the feed interval`);
  }

  start(): void {
    this.loop = setInterval(() => this.tick(), this.source.rules.startGapMs);
    // None of these timers should keep the process alive once the server has closed:
    this.loop.unref();
  }

  stop(): void {
    clearInterval(this.loop);
  }

  /**
   * New trackers: those already due join the queue, the others when they are. "Not due" happens
   * after a restart, or when a feed comes back soon after its tracker was removed.
   */
  add(trackers: Tracker[]): void {
    const now = Date.now();
    for (const tracker of [...trackers].sort((a, b) => a.dueAt - b.dueAt))
      if (tracker.dueAt <= now) this.queue.push(tracker);
      else this.after(tracker.dueAt - now, () => this.enqueue(tracker));
  }

  /** Never cancelled: after `stop()` the action only fills a queue nobody reads any more. */
  private after(delayMs: number, action: () => void): void {
    setTimeout(action, delayMs).unref();
  }

  /** A tracker can be removed while it waits for a timer: that is where it stops being polled. */
  private enqueue(tracker: Tracker): void {
    if (!tracker.removed) this.queue.push(tracker);
  }

  /**
   * At most one start per tick: that is the gap between request starts. With all the slots taken the
   * head just waits for a later tick. Nobody awaits the call, it looks after its own errors.
   */
  private tick(): void {
    // Only the head needs checking: a removed one further back gets here in its turn.
    while (this.queue[0]?.removed) this.queue.shift();
    if (this.queue.length > 0 && this.inFlight < this.source.rules.maxInFlight)
      void this.call(this.queue.shift()!);
  }

  private async call(tracker: Tracker): Promise<void> {
    const { rules } = this.source;
    const startedAt = Date.now();
    this.inFlight++;
    tracker.inFlight = true;
    // Counted from the start, as in legacy, so a slow call does not push the next one back. Saved
    // before the request, because a hit counts for the source even if we crash during it:
    this.onCallStart(tracker, startedAt);
    this.after(rules.feedIntervalMs, () => this.onIntervalOver(tracker));

    // Covers the whole call, all its requests; each request has a shorter limit of its own:
    const signal: AbortSignal = AbortSignal.any([
      AbortSignal.timeout(rules.callTimeoutMs),
      this.shutdownSignal,
    ]);
    try {
      const result = await this.source.poll(tracker.feedId, tracker.track, signal, (points) =>
        tracker.applyLatest(points),
      );
      tracker.applyResult(result);
      // The status and all the headers go to the log: neither service documents its limits, so the
      // first real refusal has to be captured whole.
      const took = `${result.requestCount} request(s), ${Date.now() - startedAt} ms`;
      for (const warning of result.warnings ?? [])
        this.log.warn(`${this.source.name} poll of ${tracker.key}: ${warning}`);
      if (result.error) {
        const { kind, detail, status, headers, retryAfterMs } = result.error;
        this.log.warn(
          { kind, status, headers, retryAfterMs },
          `${this.source.name} poll of ${tracker.key} failed: ${kind}${detail ? `, ${detail}` : ''}, ${took}`,
        );
      } else {
        this.log.info(
          `${this.source.name} poll of ${tracker.key}: ${result.points.length} points, ${took}`,
        );
      }
    } catch (err) {
      // A shutdown ends the calls; anything else here is a bug of ours, and the feed goes on:
      if (!this.shutdownSignal.aborted) this.onThrow(err, tracker);
    } finally {
      this.inFlight--;
      tracker.inFlight = false;
      if (tracker.dueWhenDone) {
        tracker.dueWhenDone = false;
        this.enqueue(tracker);
      }
    }
  }

  private onThrow(err: unknown, tracker: Tracker): void {
    const message = `${this.source.name} poll of ${tracker.key} threw`;
    if (this.threw) this.log.warn(err, message);
    else this.log.error(err, `${message}; any more this run are WARNs`);
    this.threw = true;
  }

  /** The feed may be hit again. Normally its call ended long ago. */
  private onIntervalOver(tracker: Tracker): void {
    tracker.dueAt = Date.now();
    if (tracker.inFlight) {
      this.log.warn(`${this.source.name}: the call of ${tracker.key} outlasted the feed interval`);
      tracker.dueWhenDone = true;
    } else {
      this.enqueue(tracker);
    }
  }
}
