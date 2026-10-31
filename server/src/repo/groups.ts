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

import type { Pool } from '../db.ts';

export interface PublicGroup {
  id: number;
  name: string;
  owner: string;
  trackers: number;
  views: number;
  newestCoordTs: Date | null;
  /** Not public: only an admin is shown such a group (in the list of other people's groups). */
  unlisted: boolean;
}

export interface PublicGroupsList {
  groups: PublicGroup[];
  /** All groups that qualify for the public list, shown or not. */
  total: number;
}

/**
 * By default only groups updated within this many days of the newest update anywhere are listed.
 */
export const RECENT_WINDOW_DAYS = 7;

// Same rule as the legacy site: public and with at least two trackers.
const GROUP_ROWS = `
  SELECT g.id, g.name, u.username AS owner, g.views_num AS views, g.newest_coord_ts, g.is_public,
         (SELECT count(*)::int FROM group_trackers t WHERE t.group_id = g.id) AS trackers
  FROM groups g JOIN users u ON u.id = g.user_id`;

/**
 * `where` refers to its own parameters as {1}, {2}, ... (their numbers differ between the two
 * queries below).
 */
const withParams = (where: string, offset: number) =>
  where.replace(/\{(\d+)\}/g, (_m, n: string) => `$${Number(n) + offset}`);

/**
 * The groups that qualify (`where` and at least two trackers), newest position first, groups
 * without any position last. Unless `all` is set, only groups updated within RECENT_WINDOW_DAYS of
 * the newest update among the qualifying ones are returned (the window is counted back from the
 * newest map, not from now, so a quiet site still shows something).
 */
async function listGroups(
  pool: Pool,
  all: boolean,
  where: string,
  params: unknown[],
): Promise<PublicGroupsList> {
  const eligible = (offset: number) =>
    `SELECT * FROM (${GROUP_ROWS} WHERE ${withParams(where, offset)}) rows WHERE trackers > 1`;
  const [list, count] = await Promise.all([
    pool.query<{
      id: number;
      name: string;
      owner: string;
      trackers: number;
      views: number;
      newest_coord_ts: Date | null;
      is_public: boolean;
    }>(
      `WITH listed AS (${eligible(2)}),
            latest AS (SELECT max(newest_coord_ts) AS ts FROM listed)
       SELECT l.* FROM listed l, latest
       WHERE $1::boolean OR l.newest_coord_ts >= latest.ts - make_interval(days => $2::int)
       ORDER BY l.newest_coord_ts DESC NULLS LAST, l.id`,
      [all, RECENT_WINDOW_DAYS, ...params],
    ),
    pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM (${eligible(0)}) listed`,
      params,
    ),
  ]);
  return {
    groups: list.rows.map((r) => ({
      id: r.id,
      name: r.name,
      owner: r.owner,
      trackers: r.trackers,
      views: r.views,
      newestCoordTs: r.newest_coord_ts,
      unlisted: !r.is_public,
    })),
    total: count.rows[0]?.total ?? 0,
  };
}

/** Groups shown to anonymous visitors on the home page: the public ones. */
export function listPublicGroups(pool: Pool, { all }: { all: boolean }): Promise<PublicGroupsList> {
  return listGroups(pool, all, 'g.is_public', []);
}

/**
 * What a signed-in user gets with "Show others' groups": other people's public groups; an admin
 * also gets the unlisted ones.
 */
export function listOthersGroups(
  pool: Pool,
  userId: string,
  { all, admin }: { all: boolean; admin: boolean },
): Promise<PublicGroupsList> {
  return listGroups(pool, all, 'g.user_id <> {1} AND ({2}::boolean OR g.is_public)', [
    userId,
    admin,
  ]);
}

export interface UserGroup {
  id: number;
  name: string;
  trackers: number;
  views: number;
  /** How many times the map page asked for fresh positions (shown to admins only). */
  updates: number;
  newestCoordTs: Date | null;
  /**
   * The event (task) the group's map shows, when it is relevant to the user's events mode;
   * `taskPoints` is how many points its task has.
   */
  event: { name: string; taskPoints: number } | null;
}

export interface UserGroupsList {
  groups: UserGroup[];
  /**
   * Legacy rule: the Task column is shown in the multiple-events mode, or when the default event
   * has waypoints.
   */
  showTask: boolean;
  /** Single-event mode: the Task column says Yes / No instead of naming the event. */
  simpleEvents: boolean;
}

/** The groups a user owns, by name (public or not). */
export async function listUserGroups(pool: Pool, userId: string): Promise<UserGroupsList> {
  const [list, profile] = await Promise.all([
    pool.query<{
      id: number;
      name: string;
      trackers: number;
      views: number;
      updates: string;
      newest_coord_ts: Date | null;
      event_name: string | null;
      task_points: number;
    }>(
      // The event only counts when the user is in the multiple-events mode or it is their default
      // event.
      `SELECT g.id, g.name, g.views_num AS views, g.page_updates_num::text AS updates,
        g.newest_coord_ts,
              (SELECT count(*)::int FROM group_trackers t WHERE t.group_id = g.id) AS trackers,
              CASE WHEN NOT COALESCE(up.is_simple_events_model, true)
                OR up.default_event_id = g.event_id THEN e.name END AS event_name,
              (SELECT count(*)::int FROM tasks k JOIN waypoints w ON w.id = k.waypoint_id
                WHERE w.event_id = g.event_id) AS task_points
       FROM groups g
       LEFT JOIN user_profiles up ON up.user_id = g.user_id
       LEFT JOIN events e ON e.id = g.event_id
       WHERE g.user_id = $1 ORDER BY lower(g.name), g.id`,
      [userId],
    ),
    pool.query<{ simple: boolean; default_wpts: number }>(
      `SELECT is_simple_events_model AS simple,
              (SELECT count(*)::int FROM waypoints w
                WHERE w.event_id = up.default_event_id) AS default_wpts
       FROM user_profiles up WHERE up.user_id = $1`,
      [userId],
    ),
  ]);
  const simpleEvents = profile.rows[0]?.simple ?? true;
  return {
    groups: list.rows.map((r) => ({
      id: r.id,
      name: r.name,
      trackers: r.trackers,
      views: r.views,
      updates: Number(r.updates),
      newestCoordTs: r.newest_coord_ts,
      event: r.event_name === null ? null : { name: r.event_name, taskPoints: r.task_points },
    })),
    showTask: !simpleEvents || (profile.rows[0]?.default_wpts ?? 0) > 0,
    simpleEvents,
  };
}
