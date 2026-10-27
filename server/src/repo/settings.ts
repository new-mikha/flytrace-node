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

/** A user's settings, kept in `user_profiles` (the row is created by the first save). */
export interface UserSettings {
  /** `single`: one default event ("Today Task"); `multiple`: many events. */
  eventsMode: 'single' | 'multiple';
  /** How maps show altitude: not at all, in feet or in kilometers (the legacy name of the metric choice is "Meters", stored as `m`, but the map shows km). */
  altitude: 'none' | 'ft' | 'm';
  /** Whether a new group shows or hides owner-defined messages. */
  messagesByDefault: 'show' | 'hide';
}

export const DEFAULT_SETTINGS: UserSettings = { eventsMode: 'single', altitude: 'none', messagesByDefault: 'show' };

export async function getSettings(pool: Pool, userId: string): Promise<UserSettings> {
  const { rows } = await pool.query<{ simple: boolean; altitude_unit: 'm' | 'ft' | null; messages: boolean }>(
    `SELECT is_simple_events_model AS simple, altitude_unit, show_user_messages_by_default AS messages
     FROM user_profiles WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return DEFAULT_SETTINGS;
  return {
    eventsMode: row.simple ? 'single' : 'multiple',
    altitude: row.altitude_unit ?? 'none',
    messagesByDefault: row.messages ? 'show' : 'hide',
  };
}

export async function saveSettings(pool: Pool, userId: string, s: UserSettings): Promise<void> {
  await pool.query(
    `INSERT INTO user_profiles (user_id, is_simple_events_model, altitude_unit, show_user_messages_by_default)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET is_simple_events_model = EXCLUDED.is_simple_events_model,
       altitude_unit = EXCLUDED.altitude_unit, show_user_messages_by_default = EXCLUDED.show_user_messages_by_default`,
    [userId, s.eventsMode === 'single', s.altitude === 'none' ? null : s.altitude, s.messagesByDefault === 'show'],
  );
}

/** The submitted value of one setting, or null when it is not one of the offered choices. */
export function parseSetting<K extends keyof UserSettings>(key: K, value: string): UserSettings[K] | null {
  const choices: { [P in keyof UserSettings]: readonly string[] } = {
    eventsMode: ['single', 'multiple'], altitude: ['none', 'ft', 'm'], messagesByDefault: ['show', 'hide'],
  };
  return choices[key].includes(value) ? (value as UserSettings[K]) : null;
}
