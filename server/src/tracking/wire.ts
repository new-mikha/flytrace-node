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

// What the map page's script (`public/js/map/main.js`) is sent. The names are the ones the script reads
// (they are the legacy ones), so they stay capitalised. Dates travel as ISO 8601 text, which is what
// `JSON.stringify` makes of a `Date`; `public/js/map/tracker-api.js` turns them back into dates.

/** The latest position of one tracker. */
export interface CoordItem {
  Name: string;
  Lat: number;
  Lon: number;
  /** Always metres, whatever `AltitudeUnits` says: the script converts it for showing. */
  Alt: number | null;
  /** `wait` (not fetched yet), `TRACK`, `OK`, `TEST`, `HELP`, `SOS`, `CUSTOM`, or null (no position). */
  Type: string | null;
  UsrMsg: string | null;
  Ts: Date;
  /** Seconds between `Ts` and the moment of the answer. */
  Age: number;
  /** What is wrong with the tracker, in words for the person looking at the map. */
  Error: string | null;
  PrevLat: number;
  PrevLon: number;
  PrevTs: Date;
  PrevAge: number;
  IsHidden: boolean;
}

/** The answer to the coordinates request: always the whole group. */
export interface GroupData {
  Trackers: CoordItem[] | null;
  AltitudeUnits: string | null;
  /** Points older than this are not drawn (the event's "hide old points"). */
  StartTs: Date | null;
  /** The page reloads itself when this changes, so a new version of the script is picked up. */
  Ver: number;
}

export interface TrackPoint {
  Lat: number;
  Lon: number;
  Ts: Date;
  Age: number;
  /** Set on the newest point of a track only. */
  Type: string | null;
}

export interface TrackResponseItem {
  TrackerName: string;
  /** Newest first. */
  Track: TrackPoint[];
}

/** The body of the tracks request. `LaterThan` is the newest point the page already holds. */
export interface TrackRequest {
  Items: { TrackerName: string; LaterThan?: string | null }[];
}
