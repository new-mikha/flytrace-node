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

// One source's timeline: its queue, its 2 second loop, its calls in flight. Sources run side by side
// and know nothing of each other.
import type { FastifyBaseLogger } from 'fastify';
import type { TrackerSource } from './sources/types.ts';
import type { Tracker } from './tracker.ts';

export class Pipeline {
  /** Only trackers that are due. */
  private readonly queue: Tracker[] = [];
  private inFlight = 0;
  private loop: NodeJS.Timeout | undefined;

  constructor(
    private readonly source: TrackerSource,
    private readonly log: FastifyBaseLogger,
    private readonly shutdown: AbortSignal,
    /** Called as a call starts, with the time to remember for the feed. */
    private readonly onCallStart: (tracker: Tracker, now: number) => void,
  ) {
    const { callTimeoutMs, feedIntervalMs } = source.rules;
    if (callTimeoutMs >= feedIntervalMs)
      throw new Error(`${source.name}: a call may not last as long as the feed interval`);
  }

  start(): void {
    this.loop = setInterval(() => this.tick(), this.source.rules.startGapMs);
    this.loop.unref();
  }

  stop(): void {
    clearInterval(this.loop);
  }

  /** New trackers: those already due join the queue, the others when they are. */
  add(trackers: Tracker[]): void {
    const now = Date.now();
    for (const tracker of [...trackers].sort((a, b) => a.dueAt - b.dueAt))
      if (tracker.dueAt <= now) this.queue.push(tracker);
      else this.after(tracker.dueAt - now, () => this.enqueue(tracker));
  }

  private after(delayMs: number, action: () => void): void {
    setTimeout(action, delayMs).unref();
  }

  private enqueue(tracker: Tracker): void {
    if (!tracker.removed) this.queue.push(tracker);
  }

  /** At most one start per tick: that is the gap between request starts. */
  private tick(): void {
    while (this.queue[0]?.removed) this.queue.shift();
    if (this.queue.length > 0 && this.inFlight < this.source.rules.maxInFlight)
      void this.call(this.queue.shift()!);
  }

  private async call(tracker: Tracker): Promise<void> {
    const { rules } = this.source;
    const startedAt = Date.now();
    this.inFlight++;
    tracker.inFlight = true;
    this.onCallStart(tracker, startedAt);
    this.after(rules.feedIntervalMs, () => this.onIntervalOver(tracker));

    const signal = AbortSignal.any([AbortSignal.timeout(rules.callTimeoutMs), this.shutdown]);
    try {
      const result = await this.source.poll(tracker.feedId, tracker.track, signal, (points) =>
        tracker.applyLatest(points),
      );
      tracker.applyResult(result);
      const took = `${result.requestCount} request(s), ${Date.now() - startedAt} ms`;
      if (result.error) {
        const { kind, detail, status, headers, retryAfterMs } = result.error;
        this.log.warn(
          { kind, status, headers, retryAfterMs },
          `${this.source.name} poll failed: ${kind}${detail ? `, ${detail}` : ''}, ${took}`,
        );
      } else {
        this.log.info(`${this.source.name} poll: ${result.points.length} points, ${took}`);
      }
    } catch (err) {
      // A shutdown ends the calls; anything else here is a bug of ours, and the feed goes on:
      if (!this.shutdown.aborted) this.log.error(err, `${this.source.name} poll threw`);
    } finally {
      this.inFlight--;
      tracker.inFlight = false;
      if (tracker.dueWhenDone) {
        tracker.dueWhenDone = false;
        this.enqueue(tracker);
      }
    }
  }

  private onIntervalOver(tracker: Tracker): void {
    tracker.dueAt = Date.now();
    if (tracker.inFlight) {
      this.log.warn(`${this.source.name}: a call outlasted the feed interval`);
      tracker.dueWhenDone = true;
    } else {
      this.enqueue(tracker);
    }
  }
}
