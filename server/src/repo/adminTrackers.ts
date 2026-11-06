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

// The admin's list of the trackers held in memory (`/admin/trackers`): what a row shows and which
// order it comes in. Read from `Tracker`s as the polling leaves them.
import type { Tracker } from '../tracking/tracker.ts';
import { sources } from '../tracking/sources/index.ts';
import type { SourceType } from '../tracking/sources/types.ts';
import type { AdminTrackerRow } from '../views/AdminTrackerPages.tsx';

/** Newest request first: what is being watched now comes before what is about to be dropped. */
export function trackerRows(trackers: readonly Tracker[]): AdminTrackerRow[] {
  return [...trackers]
    .sort((a, b) => b.accessedAt - a.accessedAt || a.key.localeCompare(b.key))
    .map((t) => ({
      key: t.key,
      source: sources[t.key.charAt(0) as SourceType]?.name ?? t.key.charAt(0),
      state: t.inFlight ? 'calling' : !t.answered ? 'waiting' : 'idle',
      latest: t.latest && { lat: t.latest.lat, lon: t.latest.lon, ts: t.latest.ts },
      previous: t.previous && { lat: t.previous.lat, lon: t.previous.lon, ts: t.previous.ts },
      error: t.error && {
        kind: t.error.kind,
        message: t.error.userMessage,
        status: t.error.status ?? null,
      },
      trackPoints: t.track?.length ?? null,
      createdAt: new Date(t.createdAt),
      accessedAt: new Date(t.accessedAt),
      refreshedAt: t.refreshedAt === null ? null : new Date(t.refreshedAt),
    }));
}
