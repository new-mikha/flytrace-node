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

import type { CurrentUser } from '../auth/service.ts';
import { formatAge, formatTimestamp } from './format.ts';
import { Layout } from './Layout.tsx';

export interface AdminTrackerPoint {
  lat: number;
  lon: number;
  ts: Date;
}

export interface AdminTrackerRow {
  /** `S:<feed id>` or `G:<feed id>`. */
  key: string;
  source: string;
  state: 'waiting' | 'calling' | 'idle';
  latest: AdminTrackerPoint | null;
  previous: AdminTrackerPoint | null;
  error: { kind: string; message: string; status: number | null } | null;
  /** Null until a whole first fetch is done. */
  trackPoints: number | null;
  createdAt: Date;
  accessedAt: Date;
  refreshedAt: Date | null;
}

const STATES = {
  waiting: { label: 'Waiting', badge: 'text-bg-secondary' },
  calling: { label: 'Calling', badge: 'text-bg-info' },
  idle: { label: 'Idle', badge: 'text-bg-success' },
} as const;

/** A time, and how long ago it was. */
function Time({ time, now }: { time: Date | null; now: Date }) {
  if (!time) return <span class="text-body-secondary">-</span>;
  return (
    <>
      <span class="text-nowrap">{formatTimestamp(time, now)}</span>{' '}
      <span class="text-body-secondary text-nowrap">{formatAge(time, now).text}</span>
    </>
  );
}

function Point({ point, now }: { point: AdminTrackerPoint | null; now: Date }) {
  if (!point) return <span class="text-body-secondary">-</span>;
  return (
    <>
      <span class="text-nowrap">
        {point.lat}, {point.lon}
      </span>
      <br />
      <Time time={point.ts} now={now} />
    </>
  );
}

function TrackerRow({ t, now }: { t: AdminTrackerRow; now: Date }) {
  const state = STATES[t.state];
  return (
    <tr>
      <td class="fw-semibold ft-name-cell ft-name-wide text-break">
        {t.key}
        <div class="small fw-normal text-body-secondary">
          {t.source} <span class={`badge ${state.badge}`}>{state.label}</span>{' '}
          {t.trackPoints !== null &&
            `${t.trackPoints} track point${t.trackPoints === 1 ? '' : 's'}`}
        </div>
      </td>
      <td class="ft-card-task" data-label="Latest">
        <Point point={t.latest} now={now} />
      </td>
      <td class="ft-card-task" data-label="Previous">
        <Point point={t.previous} now={now} />
      </td>
      <td
        class={`ft-card-task${t.error ? '' : ' ft-card-hide'}`}
        data-label="Error"
        style="min-width: 12rem"
      >
        {t.error ? (
          <span class="text-danger">
            {t.error.kind}
            {t.error.status !== null && ` (HTTP ${t.error.status})`}: {t.error.message}
          </span>
        ) : (
          <span class="text-body-secondary">-</span>
        )}
      </td>
      <td class="ft-card-task ft-nowrap-xl">
        <div>
          Created: <Time time={t.createdAt} now={now} />
        </div>
        <div>
          Asked for: <Time time={t.accessedAt} now={now} />
        </div>
        <div>
          Refreshed: <Time time={t.refreshedAt} now={now} />
        </div>
      </td>
    </tr>
  );
}

export function AdminTrackersPage({
  user,
  path,
  trackers,
  now,
}: {
  user: CurrentUser;
  path: string;
  trackers: AdminTrackerRow[];
  now: Date;
}) {
  return (
    <Layout title="Trackers in memory" user={user} path={path} card="wide">
      <section class="ft-section">
        <h5 class="ft-section-title">
          <i class="fa-solid fa-satellite-dish ft-heading-icon" aria-hidden="true"></i> Trackers in
          memory ({trackers.length})
        </h5>
        <p class="mb-2">
          <a href="/admin">Users</a>
        </p>
        {trackers.length === 0 ? (
          <p>No tracker is held: nobody has had a map open for the last 20 minutes.</p>
        ) : (
          <div class="table-responsive-xl ft-table-wrap ft-sticky-head">
            <table class="table table-striped table-hover align-middle ft-table ft-cards mb-0">
              <caption class="visually-hidden">Trackers in memory</caption>
              <thead>
                <tr>
                  <th scope="col">Feed</th>
                  <th scope="col">Latest</th>
                  <th scope="col">Previous</th>
                  <th scope="col">Error</th>
                  <th scope="col">Times</th>
                </tr>
              </thead>
              <tbody>
                {trackers.map((t) => (
                  <TrackerRow key={t.key} t={t} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}
