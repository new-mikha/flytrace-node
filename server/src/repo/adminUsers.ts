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

import { endSessions } from '../auth/accounts.ts';
import type { Pool } from '../db.ts';

export const USERS_PAGE_SIZE = 50;

export type SortKey = 'username' | 'email' | 'roles' | 'groups' | 'locked' | 'lastLogin';
export interface UserSort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_SORT: UserSort = { key: 'username', dir: 'asc' };
/** What a first click on a column does: names A to Z, but the biggest, newest or locked first for figures, dates and the lock. */
export const FIRST_DIR: Record<SortKey, UserSort['dir']> = {
  username: 'asc',
  email: 'asc',
  roles: 'asc',
  groups: 'desc',
  locked: 'desc',
  lastLogin: 'desc',
};

// Fixed SQL per key (nothing from the request is put into the query). Empty emails, users without roles and never-seen logins go
// last in both directions (almost everybody has no role, so the few with roles come first). Roles compare as their names in order.
const ORDER_BY: Record<SortKey, (dir: string) => string> = {
  username: (dir) => `u.username ${dir}`,
  email: (dir) => `u.email ${dir} NULLS LAST`,
  roles: (dir) => `string_agg(r.name::text, ', ' ORDER BY r.name) ${dir} NULLS LAST`,
  groups: (dir) => `groups ${dir}`,
  locked: (dir) => `u.is_locked_out ${dir}`,
  lastLogin: (dir) => `u.last_login_at ${dir} NULLS LAST`,
};

/** Unknown values fall back to the default order. */
export function parseSort(key: unknown, dir: unknown): UserSort {
  if (typeof key !== 'string' || !Object.hasOwn(ORDER_BY, key)) return DEFAULT_SORT;
  return {
    key: key as SortKey,
    dir: dir === 'asc' || dir === 'desc' ? dir : FIRST_DIR[key as SortKey],
  };
}

export interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  roles: string[];
  groups: number;
  lastLoginAt: Date | null;
  locked: boolean;
}

/** Users in the given order (then by name), optionally those whose user name or email contains `q` (case-insensitive). 1-based page. */
export async function listUsers(
  pool: Pool,
  q: string,
  pageNo: number,
  sort: UserSort = DEFAULT_SORT,
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const where = `($1::text IS NULL OR u.username ILIKE $1 OR u.email ILIKE $1)`;
  const [list, count] = await Promise.all([
    pool.query<{
      id: string;
      username: string;
      email: string | null;
      roles: string[];
      groups: number;
      last_login_at: Date | null;
      locked: boolean;
    }>(
      `SELECT u.id, u.username, u.email, u.last_login_at, u.is_locked_out AS locked,
              COALESCE(array_agg(r.name::text) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
              (SELECT count(*) FROM groups g WHERE g.user_id = u.id)::int AS groups
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE ${where}
       GROUP BY u.id ORDER BY ${ORDER_BY[sort.key](sort.dir)}, u.username LIMIT $2 OFFSET $3`,
      [like, USERS_PAGE_SIZE, (pageNo - 1) * USERS_PAGE_SIZE],
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM users u WHERE ${where}`, [like]),
  ]);
  return {
    rows: list.rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      roles: r.roles,
      groups: r.groups,
      lastLoginAt: r.last_login_at,
      locked: r.locked,
    })),
    total: count.rows[0]!.n,
  };
}

/** Everything the admin's user page shows about one user. Never the password hash or the two-factor secret. */
export interface ManagedUser {
  id: string;
  username: string;
  email: string | null;
  emailConfirmed: boolean;
  twoFactorEnabled: boolean;
  locked: boolean;
  approved: boolean;
  roles: string[];
  groups: number;
  /** Logins that are valid right now (unexpired sessions). */
  sessions: number;
  createdAt: Date;
  lastLoginAt: Date | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getManagedUser(pool: Pool, id: string): Promise<ManagedUser | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await pool.query<{
    id: string;
    username: string;
    email: string | null;
    email_confirmed: boolean;
    two_factor_enabled: boolean;
    is_locked_out: boolean;
    is_approved: boolean;
    roles: string[];
    groups: number;
    sessions: number;
    created_at: Date;
    last_login_at: Date | null;
  }>(
    `SELECT u.id, u.username, u.email, u.email_confirmed, u.two_factor_enabled, u.is_locked_out, u.is_approved,
            u.created_at, u.last_login_at,
            COALESCE(array_agg(r.name::text) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
            (SELECT count(*) FROM groups g WHERE g.user_id = u.id)::int AS groups,
            (SELECT count(*) FROM sessions s WHERE s.sess->>'userId' = u.id::text AND s.expire > now())::int AS sessions
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [id],
  );
  const r = rows[0];
  return !r
    ? null
    : {
        id: r.id,
        username: r.username,
        email: r.email,
        emailConfirmed: r.email_confirmed,
        twoFactorEnabled: r.two_factor_enabled,
        locked: r.is_locked_out,
        approved: r.is_approved,
        roles: r.roles,
        groups: r.groups,
        sessions: r.sessions,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
      };
}

/** Locking also ends the user's logins (the next request of an old session would be refused anyway). */
export async function setLocked(pool: Pool, userId: string, locked: boolean): Promise<void> {
  await pool.query('UPDATE users SET is_locked_out = $2 WHERE id = $1', [userId, locked]);
  if (locked) await endSessions(pool, userId);
}

export async function setEmailConfirmed(
  pool: Pool,
  userId: string,
  confirmed: boolean,
): Promise<void> {
  await pool.query('UPDATE users SET email_confirmed = $2 WHERE id = $1', [userId, confirmed]);
}
