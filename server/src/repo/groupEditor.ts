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

// One pilot group as its editor page shows it, and the changes the editor makes. Every change bumps
// `groups.version` (the map's cached copy of the group is stale then), in the same transaction as
// the change.
import type { Client, Pool } from '../db.ts';
import { withTransaction } from '../db.ts';
import { ensureDefaultEvent } from './events.ts';
import type { ParsedTracker } from './trackerInput.ts';

export interface GroupTracker {
  id: number;
  name: string;
  type: 'S' | 'G' | 'T';
  foreignId: string;
  isOn: boolean;
}

export interface EditableGroup {
  id: number;
  name: string;
  ownerId: string;
  owner: string;
  isPublic: boolean;
  showMessages: boolean;
  /**
   * The event whose task the group's map shows (the legacy "Today Task" in the single-event mode),
   * if any.
   */
  eventId: number | null;
  trackers: GroupTracker[];
}

export async function getGroup(pool: Pool, id: number): Promise<EditableGroup | null> {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) return null;
  const [group, trackers] = await Promise.all([
    pool.query<{
      id: number;
      name: string;
      user_id: string;
      username: string;
      is_public: boolean;
      display_user_messages: boolean;
      event_id: number | null;
    }>(
      `SELECT g.id, g.name, g.user_id, u.username, g.is_public, g.display_user_messages, g.event_id
       FROM groups g JOIN users u ON u.id = g.user_id WHERE g.id = $1`,
      [id],
    ),
    pool.query<{
      id: number;
      name: string;
      tracker_type: 'S' | 'G' | 'T';
      foreign_id: string;
      is_on: boolean;
    }>(
      `SELECT id, name, tracker_type, foreign_id, is_on FROM group_trackers WHERE group_id = $1
        ORDER BY id`,
      [id],
    ),
  ]);
  const g = group.rows[0];
  if (!g) return null;
  return {
    id: g.id,
    name: g.name,
    ownerId: g.user_id,
    owner: g.username,
    isPublic: g.is_public,
    showMessages: g.display_user_messages,
    eventId: g.event_id,
    trackers: trackers.rows.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.tracker_type,
      foreignId: t.foreign_id,
      isOn: t.is_on,
    })),
  };
}

/** Which unique rule a failed insert or update broke, for a readable message. */
export function duplicateOf(err: unknown): 'name' | 'feed' | null {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return null;
  return e.constraint === 'group_trackers_group_id_feed_key' ? 'feed' : 'name';
}

const bump = (c: Client, groupId: number) =>
  c.query('UPDATE groups SET version = version + 1 WHERE id = $1', [groupId]);

/**
 * `Group 01`, `Group 02`, ...: the first free number (the legacy names), with the owner's default
 * for the owner-defined messages.
 */
export async function createGroup(
  pool: Pool,
  userId: string,
  showMessages: boolean,
): Promise<{ id: number; name: string }> {
  // A new group shows the user's default event (legacy): in the single-event mode that is the Today
  // Task, made if need be.
  const {
    rows: [profile],
  } = await pool.query<{ simple: boolean; default_event_id: number | null }>(
    'SELECT is_simple_events_model AS simple, default_event_id FROM user_profiles WHERE user_id = $1',
    [userId],
  );
  const eventId =
    (profile?.simple ?? true)
      ? await ensureDefaultEvent(pool, userId)
      : (profile?.default_event_id ?? null);
  for (let attempt = 0; ; attempt++) {
    const { rows } = await pool.query<{ name: string }>(
      'SELECT name FROM groups WHERE user_id = $1',
      [userId],
    );
    const used = new Set(rows.map((r) => r.name.toLowerCase()));
    let n = 1;
    while (used.has(`group ${String(n).padStart(2, '0')}`)) n++;
    const name = `Group ${String(n).padStart(2, '0')}`;
    try {
      const {
        rows: [g],
      } = await pool.query<{ id: number }>(
        'INSERT INTO groups (name, user_id, display_user_messages, event_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, userId, showMessages, eventId],
      );
      return { id: g!.id, name };
    } catch (err) {
      // two creations at once picked the same name: look again
      if (duplicateOf(err) === null || attempt >= 3) throw err;
    }
  }
}

/** False when the owner already has another group with that name. */
export async function updateGroup(
  pool: Pool,
  g: EditableGroup,
  v: { name: string; isPublic: boolean; showMessages: boolean },
): Promise<boolean> {
  try {
    await withTransaction(pool, async (c) => {
      await bump(c, g.id);
      await c.query(
        'UPDATE groups SET name = $2, is_public = $3, display_user_messages = $4 WHERE id = $1',
        [g.id, v.name, v.isPublic, v.showMessages],
      );
    });
    return true;
  } catch (err) {
    if (duplicateOf(err) === 'name') return false;
    throw err;
  }
}

export async function deleteGroup(pool: Pool, groupId: number): Promise<void> {
  await pool.query('DELETE FROM groups WHERE id = $1', [groupId]); // trackers cascade
}

/** `'name'` or `'feed'` when the group already has such a pilot name or tracker. */
export async function addTracker(
  pool: Pool,
  groupId: number,
  name: string,
  parsed: ParsedTracker,
  asEntered: string,
): Promise<'name' | 'feed' | null> {
  try {
    await withTransaction(pool, async (c) => {
      await bump(c, groupId);
      await c.query(
        `INSERT INTO group_trackers (group_id, name, tracker_type, foreign_id,
          foreign_id_as_entered) VALUES ($1, $2, $3, $4, $5)`,
        [groupId, name, parsed.type, parsed.foreignId, asEntered.trim()],
      );
    });
    return null;
  } catch (err) {
    const dup = duplicateOf(err);
    if (dup) return dup;
    throw err;
  }
}

/** False when the group already has a pilot with that name. */
export async function renameTracker(
  pool: Pool,
  groupId: number,
  trackerId: number,
  name: string,
): Promise<boolean> {
  try {
    await withTransaction(pool, async (c) => {
      await bump(c, groupId);
      await c.query('UPDATE group_trackers SET name = $3 WHERE id = $2 AND group_id = $1', [
        groupId,
        trackerId,
        name,
      ]);
    });
    return true;
  } catch (err) {
    if (duplicateOf(err) === 'name') return false;
    throw err;
  }
}

export async function deleteTracker(
  pool: Pool,
  groupId: number,
  trackerId: number,
): Promise<boolean> {
  return withTransaction(pool, async (c) => {
    await bump(c, groupId);
    const r = await c.query('DELETE FROM group_trackers WHERE id = $2 AND group_id = $1', [
      groupId,
      trackerId,
    ]);
    return (r.rowCount ?? 0) > 0;
  });
}

/**
 * Switches the trackers on or off: those in `on` are on, every other tracker of the group is off (a
 * tracker that is off is not drawn on the map unless it sends SOS or HELP). Ids of other groups'
 * trackers are ignored.
 */
export async function setTrackersOn(pool: Pool, groupId: number, on: number[]): Promise<void> {
  await withTransaction(pool, async (c) => {
    await bump(c, groupId);
    await c.query('UPDATE group_trackers SET is_on = (id = ANY($2::int[])) WHERE group_id = $1', [
      groupId,
      on,
    ]);
  });
}

/**
 * What the group editor's task section shows: the owner's events mode and what the group's map
 * takes its task from.
 */
export interface GroupTaskInfo {
  mode: 'single' | 'multiple';
  eventId: number | null;
  eventName: string | null;
  /** The owner's default event: the Today Task of the single-event mode. */
  defaultEventId: number | null;
  /** Waypoints in the task of the group's event. */
  taskWaypoints: number;
  /** The owner's events (multiple mode, for the choice). */
  events: Array<{ id: number; name: string }>;
}

export async function getGroupTask(pool: Pool, group: EditableGroup): Promise<GroupTaskInfo> {
  const [profile, event, events] = await Promise.all([
    pool.query<{ simple: boolean; default_event_id: number | null }>(
      'SELECT is_simple_events_model AS simple, default_event_id FROM user_profiles WHERE user_id = $1',
      [group.ownerId],
    ),
    group.eventId === null
      ? null
      : pool.query<{ name: string; task: number }>(
          `SELECT e.name, (SELECT count(*)::int FROM tasks t
            JOIN waypoints w ON w.id = t.waypoint_id WHERE w.event_id = e.id) AS task
       FROM events e WHERE e.id = $1`,
          [group.eventId],
        ),
    pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM events WHERE user_id = $1 ORDER BY lower(name), id',
      [group.ownerId],
    ),
  ]);
  const p = profile.rows[0];
  const mode = (p?.simple ?? true) ? 'single' : 'multiple';
  return {
    mode,
    eventId: group.eventId,
    eventName: event?.rows[0]?.name ?? null,
    defaultEventId: p?.default_event_id ?? null,
    taskWaypoints: event?.rows[0]?.task ?? 0,
    events: mode === 'multiple' ? events.rows : [],
  };
}
