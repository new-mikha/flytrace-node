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

// What the map page's script (`public/js/map/main.js`) is sent, in camelCase (the legacy site's names
// were capitalised). Dates travel as ISO 8601 text, which is what `JSON.stringify` makes of a `Date`;
// `public/js/map/tracker-api.js` turns them back into dates.

/** The latest position of one tracker. */
export interface CoordItem {
  name: string;
  lat: number;
  lon: number;
  /** Always metres, whatever `altitudeUnits` says: the script converts it for showing. */
  alt: number | null;
  /** `wait` (not fetched yet), `TRACK`, `OK`, `TEST`, `HELP`, `SOS`, `CUSTOM`, or null (no position). */
  type: string | null;
  usrMsg: string | null;
  ts: Date;
  /** Seconds between `ts` and the moment of the answer. */
  age: number;
  /** What is wrong with the tracker, in words for the person looking at the map. */
  error: string | null;
  prevLat: number;
  prevLon: number;
  prevTs: Date;
  prevAge: number;
  isHidden: boolean;
}

/** The answer to the coordinates request: always the whole group. */
export interface GroupData {
  trackers: CoordItem[] | null;
  altitudeUnits: string | null;
  /** Points older than this are not drawn (the event's "hide old points"). */
  startTs: Date | null;
  /** The page reloads itself when this changes, so a new version of the script is picked up. */
  ver: number;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  ts: Date;
  age: number;
  /** Set on the newest point of a track only. */
  type: string | null;
}

export interface TrackResponseItem {
  trackerName: string;
  /** Newest first. */
  track: TrackPoint[];
}

/** The body of the tracks request. `laterThan` is the newest point the page already holds. */
export interface TrackRequest {
  items: { trackerName: string; laterThan?: string | null }[];
}
