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

// Folding fresh points into a track: what we keep, the same for every source.
import type { FeedPoint, HeldTrack } from './sources/types.ts';

/**
 * How far behind its own newest point a track reaches. Not behind now: a tracker that went silent
 * yesterday still shows yesterday's flight.
 */
export const TRACK_HOURS = 48;

/** Union on the time (the held point stays), newest first, trimmed to 48 h behind the newest. */
export function mergeTrack(held: HeldTrack, fresh: readonly FeedPoint[]): FeedPoint[] {
  // Held points go in first, so a point that comes again does not replace them:
  const byTime = new Map<number, FeedPoint>();
  for (const point of [...held, ...fresh])
    if (!byTime.has(point.ts.getTime())) byTime.set(point.ts.getTime(), point);

  // Sorted again because fresh points can fall anywhere, not only ahead of the held ones:
  const merged = [...byTime.values()].sort((a, b) => b.ts.getTime() - a.ts.getTime());
  if (merged.length === 0) return merged;
  const threshold = merged[0]!.ts.getTime() - TRACK_HOURS * 3600_000;
  return merged.filter((point) => point.ts.getTime() > threshold);
}
