import type { Pool } from '../db.ts';

export interface UserEvent {
  id: number;
  name: string;
  waypoints: number;
  /** The user's default event: new groups use it (the legacy "*"). */
  isDefault: boolean;
}

export interface UserEventsList {
  events: UserEvent[];
  /** Legacy rule: the events list is for the multiple-events mode; single-event mode has just the default event ("Today Task"). */
  show: boolean;
}

/** The events a user owns, by name. */
export async function listUserEvents(pool: Pool, userId: string): Promise<UserEventsList> {
  const [list, profile] = await Promise.all([
    pool.query<{ id: number; name: string; waypoints: number; is_default: boolean }>(
      `SELECT e.id, e.name, (up.default_event_id = e.id) AS is_default,
              (SELECT count(*)::int FROM waypoints w WHERE w.event_id = e.id) AS waypoints
       FROM events e LEFT JOIN user_profiles up ON up.user_id = e.user_id
       WHERE e.user_id = $1 ORDER BY lower(e.name), e.id`,
      [userId],
    ),
    pool.query<{ simple: boolean }>('SELECT is_simple_events_model AS simple FROM user_profiles WHERE user_id = $1', [userId]),
  ]);
  return {
    events: list.rows.map((r) => ({ id: r.id, name: r.name, waypoints: r.waypoints, isDefault: r.is_default === true })),
    show: !(profile.rows[0]?.simple ?? true),
  };
}
