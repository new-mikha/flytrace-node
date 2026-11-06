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

// The JSON replies to the map page's two requests, GET /map/:id/coordinates and POST /map/:id/tracks,
// made from the group's rows and what the polling holds for its feeds.
import type { MapView, MapViewTracker, NewestPosition } from '../repo/mapGroups.ts';
import type { FeedPoint } from './sources/types.ts';
import type { Tracker } from './tracker.ts';
import type { CoordItem, GroupData, TrackRequest, TrackResponseItem } from './wire.ts';

/** The page reloads itself when this changes: raise it when the script and the server must match. */
const VER = 1;

/** In seconds. Never negative: a device's clock can be ahead of ours. */
const ageOf = (ts: Date, now: Date) =>
  Math.max(0, Math.trunc((now.getTime() - ts.getTime()) / 1000));

/** Leaves out what is empty: null, false, 0 and "" (the script copes with undefined). */
function omitEmpty<T extends object>(item: T): T {
  const kept = Object.entries(item).filter(
    ([, v]) => !(v == null || v === false || v === 0 || v === ''),
  );
  return Object.fromEntries(kept) as T;
}

function coordItem(row: MapViewTracker, tracker: Tracker, view: MapView, now: Date): CoordItem {
  // Turned off in the group editor. The script still gets the tracker, and keeps it off the map:
  const hidden = !row.isOn;
  if (!tracker.answered) return omitEmpty({ name: row.name, type: 'wait', hidden });

  const { latest, previous, error } = tracker;
  const item: CoordItem = { name: row.name, hidden, error: error?.userMessage };
  if (latest) {
    item.lat = latest.lat;
    item.lon = latest.lon;
    item.type = latest.type;
    item.ts = latest.ts;
    item.age = ageOf(latest.ts, now);
    // What the group's owner chose to show:
    if (view.altitudeUnits) item.alt = latest.alt;
    if (view.showMessages) item.usrMsg = latest.userMessage;
    // `startTs` is "hide points older than" on the event page, so a hidden point must not show as
    // the current one, nor as the start of the line to it:
    if (view.startTs && latest.ts < view.startTs) item.hidden = true;
    if (previous && (!view.startTs || previous.ts > view.startTs)) {
      item.prevLat = previous.lat;
      item.prevLon = previous.lon;
      item.prevTs = previous.ts;
      item.prevAge = ageOf(previous.ts, now);
    }
  }
  return omitEmpty(item);
}

export function coordinates(view: MapView, trackers: Tracker[], now = new Date()): GroupData {
  return omitEmpty({
    trackers: view.trackers.map((row, i) => coordItem(row, trackers[i]!, view, now)),
    altitudeUnits: view.altitudeUnits ?? undefined,
    startTs: view.startTs ?? undefined,
    ver: VER,
  });
}

/** The newest position in an answer, of any tracker: turned off or hidden ones count, as in legacy. */
export function newestPosition(answer: GroupData): NewestPosition | null {
  let newest: NewestPosition | null = null;
  for (const { ts, lat = 0, lon = 0 } of answer.trackers)
    if (ts && (!newest || ts > newest.ts)) newest = { ts, lat, lon };
  return newest;
}

/** Only the newest point carries a type: the script reads it from no other. */
const trackPoint = (point: FeedPoint, isNewest: boolean, now: Date) =>
  omitEmpty({
    lat: point.lat,
    lon: point.lon,
    ts: point.ts,
    age: ageOf(point.ts, now),
    type: isNewest ? point.type : undefined,
  });

/** `rows` are the trackers asked for, in the order of `trackers`. Empty tracks are left out. */
export function tracks(
  rows: MapViewTracker[],
  trackers: Tracker[],
  request: TrackRequest,
  now = new Date(),
): TrackResponseItem[] {
  const result: TrackResponseItem[] = [];
  rows.forEach((row, i) => {
    const asked = request.items.find(
      (item) => item.trackerName.toLowerCase() === row.name.toLowerCase(),
    );
    // The page holds the rest already, so it only gets what is newer:
    const laterThan = asked?.laterThan ? new Date(asked.laterThan).getTime() : -Infinity;
    const track = (trackers[i]!.track ?? []).flatMap((point, index) =>
      point.ts.getTime() > laterThan ? [trackPoint(point, index === 0, now)] : [],
    );
    if (track.length > 0) result.push({ trackerName: row.name, track });
  });
  return result;
}
