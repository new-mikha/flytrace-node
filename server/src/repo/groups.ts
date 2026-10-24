import type { Pool } from '../db.ts';

export interface PublicGroup {
  id: number;
  name: string;
  owner: string;
  trackers: number;
  views: number;
  newestCoordTs: Date | null;
}

export interface PublicGroupsList {
  groups: PublicGroup[];
  /** All groups that qualify for the public list, shown or not. */
  total: number;
}

/** By default only groups updated within this many days of the newest update anywhere are listed. */
export const RECENT_WINDOW_DAYS = 7;

// Same rule as the legacy site: public and with at least two trackers.
const LISTED_GROUPS = `
  SELECT g.id, g.name, u.username AS owner, g.views_num AS views, g.newest_coord_ts,
         (SELECT count(*)::int FROM group_trackers t WHERE t.group_id = g.id) AS trackers
  FROM groups g JOIN users u ON u.id = g.user_id
  WHERE g.is_public`;

/**
 * Groups shown to anonymous visitors on the home page, newest position first, groups without any position last.
 * Unless `all` is set, only groups updated within RECENT_WINDOW_DAYS of the newest update are returned (the window
 * is counted back from the newest map, not from now, so a quiet site still shows something).
 */
export async function listPublicGroups(pool: Pool, { all }: { all: boolean }): Promise<PublicGroupsList> {
  const [list, count] = await Promise.all([
    pool.query<{ id: number; name: string; owner: string; trackers: number; views: number; newest_coord_ts: Date | null }>(
      `WITH listed AS (SELECT * FROM (${LISTED_GROUPS}) eligible WHERE trackers > 1),
            latest AS (SELECT max(newest_coord_ts) AS ts FROM listed)
       SELECT l.* FROM listed l, latest
       WHERE $1::boolean OR l.newest_coord_ts >= latest.ts - make_interval(days => $2::int)
       ORDER BY l.newest_coord_ts DESC NULLS LAST, l.id`,
      [all, RECENT_WINDOW_DAYS],
    ),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM (${LISTED_GROUPS}) eligible WHERE trackers > 1`),
  ]);
  return {
    groups: list.rows.map((r) => ({
      id: r.id, name: r.name, owner: r.owner, trackers: r.trackers, views: r.views, newestCoordTs: r.newest_coord_ts,
    })),
    total: count.rows[0]?.total ?? 0,
  };
}

export interface UserGroup {
  id: number;
  name: string;
  trackers: number;
  views: number;
  /** How many times the map page asked for fresh positions (shown to admins only). */
  updates: number;
  newestCoordTs: Date | null;
}

/** The groups a user owns, by name (public or not). */
export async function listUserGroups(pool: Pool, userId: string): Promise<UserGroup[]> {
  const { rows } = await pool.query<{ id: number; name: string; trackers: number; views: number; updates: string; newest_coord_ts: Date | null }>(
    `SELECT g.id, g.name, g.views_num AS views, g.page_updates_num::text AS updates, g.newest_coord_ts,
            (SELECT count(*)::int FROM group_trackers t WHERE t.group_id = g.id) AS trackers
     FROM groups g WHERE g.user_id = $1 ORDER BY lower(g.name), g.id`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, trackers: r.trackers, views: r.views, updates: Number(r.updates), newestCoordTs: r.newest_coord_ts,
  }));
}
