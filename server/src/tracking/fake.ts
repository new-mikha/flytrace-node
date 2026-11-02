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

// Made-up answers for the map page, until the trackers are really polled: the 21 trackers of one
// legacy group (anonymised, `fake-data/`), shown in three stages as a real group would be while the
// feeds are being fetched for the first time:
//
//   1. the page has just opened: every tracker is "wait";
//   2. the first half of the trackers have answered;
//   3. all of them have.
//
// Each coordinates request moves its group one stage on (and stays at the last), and opening the map
// page starts the group again from the first. The tracks follow the stage: a tracker that is still
// "wait" has none, as in the real thing.

import trackersJson from './fake-data/trackers.json' with { type: 'json' };
import tracksJson from './fake-data/tracks.json' with { type: 'json' };
import type { CoordItem, GroupData, TrackPoint, TrackRequest, TrackResponseItem } from './wire.ts';

/** What the fixture files hold: the source's facts. `age` is worked out when answering. */
interface FakeTracker {
  name: string;
  lat: number;
  lon: number;
  alt: number | null;
  type: string | null;
  usrMsg: string | null;
  ts: string;
  error: string | null;
  prevLat: number;
  prevLon: number;
  prevTs: string;
  hidden: boolean;
}

interface FakeTrack {
  trackerName: string;
  track: { lat: number; lon: number; ts: string; type: string | null }[];
}

const TRACKERS = trackersJson as FakeTracker[];
const TRACKS = tracksJson as FakeTrack[];

/** .NET's `DateTime.MinValue`, which the script takes for "no time". */
const NO_TIME = new Date('0001-01-01T00:00:00.000Z');

const LAST_STAGE = 3;

/** Coordinates requests answered since the map page was opened, by group. */
const requests = new Map<number, number>();

/** Called when the map page is opened: the group starts again from "wait". */
export function restartFakeGroup(groupId: number): void {
  requests.set(groupId, 0);
}

function currentStage(groupId: number): number {
  return Math.max(1, Math.min(requests.get(groupId) ?? 0, LAST_STAGE));
}

function hasAnswered(index: number, stage: number): boolean {
  return stage >= LAST_STAGE || (stage === 2 && index < Math.ceil(TRACKERS.length / 2));
}

function ageSeconds(ts: Date, now: Date): number {
  return ts.getTime() === NO_TIME.getTime()
    ? 0
    : Math.max(0, Math.round((now.getTime() - ts.getTime()) / 1000));
}

/** Leaves out what is empty: null, false, 0, "" and "no time" (the script copes with undefined). */
function omitEmpty<T extends object>(item: T): T {
  const kept = Object.entries(item).filter(
    ([, v]) => !(v == null || v === false || v === 0 || v === '' || isNoTime(v)),
  );
  return Object.fromEntries(kept) as T;
}

function isNoTime(v: unknown): boolean {
  return v instanceof Date && v.getTime() === NO_TIME.getTime();
}

function waiting(name: string): CoordItem {
  return { name, type: 'wait' };
}

function answered(tracker: FakeTracker, now: Date): CoordItem {
  const ts = new Date(tracker.ts);
  const prevTs = new Date(tracker.prevTs);
  return omitEmpty({
    ...tracker,
    ts,
    age: ageSeconds(ts, now),
    prevTs,
    prevAge: ageSeconds(prevTs, now),
  }) as CoordItem;
}

/** The answer to a coordinates request. */
export function fakeCoordinates(groupId: number, now = new Date()): GroupData {
  requests.set(groupId, (requests.get(groupId) ?? 0) + 1);
  const stage = currentStage(groupId);
  return {
    trackers: TRACKERS.map((tracker, index) =>
      hasAnswered(index, stage) ? answered(tracker, now) : waiting(tracker.name),
    ),
    altitudeUnits: 'm',
    ver: 2,
  };
}

/** The answer to a tracks request: only the trackers that have answered, only the newer points. */
export function fakeTracks(
  groupId: number,
  request: TrackRequest,
  now = new Date(),
): TrackResponseItem[] {
  const stage = currentStage(groupId);
  const result: TrackResponseItem[] = [];
  for (const item of request.items ?? []) {
    const index = TRACKERS.findIndex(
      (t) => t.name.toLowerCase() === String(item.trackerName).toLowerCase(),
    );
    const track = TRACKS.find((t) => t.trackerName === TRACKERS[index]?.name);
    if (index < 0 || !track || !hasAnswered(index, stage)) continue;

    const laterThan = item.laterThan ? new Date(item.laterThan) : null;
    const points = track.track
      .map((p) => omitEmpty({ ...p, ts: new Date(p.ts), age: ageSeconds(new Date(p.ts), now) }))
      .filter((p) => !laterThan || p.ts.getTime() > laterThan.getTime()) as TrackPoint[];
    if (points.length > 0) result.push({ trackerName: track.trackerName, track: points });
  }
  return result;
}
