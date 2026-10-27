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

// The anonymous home page against the dev database: which groups are listed, in which order (needs `npm run db:migrate`).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const OWNER = `__test_owner_${run}`;
let app: FastifyInstance;
let pool: Pool;

async function addGroup(name: string, isPublic: boolean, trackers: number, newest: string | null): Promise<number> {
  const { rows: [g] } = await pool.query<{ id: number }>(
    `INSERT INTO groups (name, user_id, is_public, newest_coord_ts)
     SELECT $1, id, $2, $3 FROM users WHERE username = $4 RETURNING id`,
    [name, isPublic, newest, OWNER]);
  for (let i = 1; i <= trackers; i++) {
    await pool.query(`INSERT INTO group_trackers (group_id, name, tracker_type, foreign_id) VALUES ($1, $2, 'S', $3)`,
      [g!.id, `T${i}`, `${name}-feed-${i}`]);
  }
  return g!.id;
}

beforeAll(async () => {
  const config = loadConfig();
  pool = createPool(config.DATABASE_URL);
  await pool.query(`INSERT INTO users (username, password_hash) VALUES ($1, 'x')`, [OWNER]);
  // The newest map defines "now" for the recent window, so these are dated far in the future of the real data.
  await addGroup(`Newest ${run}`, true, 3, '2030-01-01T10:00:00Z');
  await addGroup(`EdgeIn ${run}`, true, 2, '2029-12-25T10:00:00Z');  // exactly 7 days before the newest: still recent
  await addGroup(`EdgeOut ${run}`, true, 2, '2029-12-25T09:59:59Z'); // one second older: hidden by default
  await addGroup(`Older ${run}`, true, 2, '2020-01-01T10:00:00Z');
  await addGroup(`NoFix ${run}`, true, 2, null);
  await addGroup(`Private ${run}`, false, 3, '2025-01-01T10:00:00Z');
  await addGroup(`Single ${run}`, true, 1, '2025-01-01T10:00:00Z');
  app = await buildApp(config, pool);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username = $1', [OWNER]); // groups and trackers cascade
  await app.close();
});

describe('GET / (anonymous)', () => {
  const at = (html: string, name: string) => html.indexOf(`${name} ${run}`);

  it('by default lists only public groups with two or more trackers updated within a week of the newest one', async () => {
    const res = await app.inject({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body;
    expect(html).toContain(`Newest ${run}`);
    expect(html).toContain(`EdgeIn ${run}`);
    for (const hidden of ['EdgeOut', 'Older', 'NoFix', 'Private', 'Single']) expect(html).not.toContain(`${hidden} ${run}`);
    expect(at(html, 'Newest')).toBeLessThan(at(html, 'EdgeIn'));
    expect(html).toContain(OWNER);
    expect(html).toMatch(/Show all \d+ maps/);
    expect(html).toContain('href="/?all=1"');
  });

  it('with ?all=1 lists every qualifying group, newest first and groups without a position last', async () => {
    const res = await app.inject({ url: '/?all=1' });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    for (const shown of ['Newest', 'EdgeIn', 'EdgeOut', 'Older', 'NoFix']) expect(html).toContain(`${shown} ${run}`);
    for (const hidden of ['Private', 'Single']) expect(html).not.toContain(`${hidden} ${run}`);
    expect(at(html, 'EdgeIn')).toBeLessThan(at(html, 'EdgeOut'));
    expect(at(html, 'EdgeOut')).toBeLessThan(at(html, 'Older'));
    expect(at(html, 'Older')).toBeLessThan(at(html, 'NoFix'));
    expect(html).toContain('Show only the latest week');
    expect(html).not.toMatch(/Show all \d+ maps/);
  });

  it('?fragment=1 returns only the list section, for the in-place swap', async () => {
    const short = await app.inject({ url: '/?fragment=1' });
    expect(short.statusCode).toBe(200);
    expect(short.headers['content-type']).toContain('text/html');
    expect(short.body).not.toContain('<html');
    expect(short.body).not.toContain('<nav');
    expect(short.body).toContain(`Newest ${run}`);
    expect(short.body).not.toContain(`Older ${run}`);
    expect(short.body).toContain('href="/?all=1"');

    const full = await app.inject({ url: '/?all=1&fragment=1' });
    expect(full.body).not.toContain('<html');
    expect(full.body).toContain(`Older ${run}`);
    expect(full.body).toContain('Show only the latest week');
  });

  it('treats any other ?all value as the default view', async () => {
    const html = (await app.inject({ url: '/?all=yes' })).body;
    expect(html).not.toContain(`Older ${run}`);
  });
});
