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

// The task of a group's map: the single-event mode's "Today Task" checkbox, the multiple-events mode's choice of event, the
// switch between the modes and "Create new event" (against the dev database).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const OWNER = `__test_towner_${run}`;
const OTHER = `__test_tother_${run}`;
const READER = `__test_treader_${run}`;
const PASSWORD = 'correct horse';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

let app: FastifyInstance;
let pool: Pool;
let ipCounter = 1;

async function loginAs(username: string) {
  const ip = `10.9.0.${ipCounter++}`;
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    remoteAddress: ip,
    headers: FORM,
    payload: new URLSearchParams({ username, password: PASSWORD, returnUrl: '/' }).toString(),
  });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid');
  const cookies: Record<string, string> = cookie ? { [cookie.name]: cookie.value } : {};
  return {
    get: (url: string) => app.inject({ url, remoteAddress: ip, cookies }),
    post: (url: string, payload: Record<string, string> = {}) =>
      app.inject({
        method: 'POST',
        url,
        remoteAddress: ip,
        cookies,
        headers: FORM,
        payload: new URLSearchParams(payload).toString(),
      }),
  };
}

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  const hash = await hashPassword(PASSWORD);
  for (const name of [OWNER, OTHER, READER])
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [name, hash]);
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = $1 AND r.name = 'SpotIdReaders'`,
    [READER],
  );
  app = await buildApp(config, pool);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username LIKE $1', [`__test_t%_${run}`]); // events and groups cascade
  await app.close();
});

const userId = async (name: string) =>
  (await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [name])).rows[0]!
    .id;
const groupEvent = async (id: number) =>
  (
    await pool.query<{ event_id: number | null; version: number }>(
      'SELECT event_id, version FROM groups WHERE id = $1',
      [id],
    )
  ).rows[0]!;
const events = async (name: string) =>
  (
    await pool.query<{ id: number; name: string }>(
      'SELECT id, name FROM events WHERE user_id = (SELECT id FROM users WHERE username = $1) ORDER BY id',
      [name],
    )
  ).rows;
const defaultEvent = async (name: string) =>
  (
    await pool.query<{ d: number | null }>(
      'SELECT default_event_id AS d FROM user_profiles WHERE user_id = (SELECT id FROM users WHERE username = $1)',
      [name],
    )
  ).rows[0]?.d ?? null;

describe('single-event mode: the Today Task', () => {
  it('makes the default event with the first group and shows it on the group', async () => {
    const owner = await loginAs(OWNER);
    const res = await owner.post('/groups');
    const id = Number(/\/groups\/(\d+)/.exec(String(res.headers.location))![1]);
    const [event] = await events(OWNER);
    expect(event?.name).toBe('Event 01');
    expect(await defaultEvent(OWNER)).toBe(event!.id);
    expect((await groupEvent(id)).event_id).toBe(event!.id);
    const page = (await owner.get(`/groups/${id}`)).body;
    expect(page).toContain('Display the Today Task on the group');
    expect(page).toContain('will show the');
    expect(page).toContain('data-guard="changed"');
  });

  it('turns the Today Task off and on from the checkbox, bumping the version', async () => {
    const owner = await loginAs(OWNER);
    const id = Number(
      /\/groups\/(\d+)/.exec(String((await owner.post('/groups')).headers.location))![1],
    );
    const before = (await groupEvent(id)).version;
    expect((await owner.post(`/groups/${id}/task`, {})).statusCode).toBe(302); // box unchecked: nothing is sent for it
    expect(await groupEvent(id)).toMatchObject({ event_id: null, version: before + 1 });
    expect((await owner.get(`/groups/${id}`)).body).toContain('not showing the Today Task');
    await owner.post(`/groups/${id}/task`, { show: '1' });
    expect((await groupEvent(id)).event_id).toBe(await defaultEvent(OWNER));
    expect(await events(OWNER)).toHaveLength(1); // the default event is reused, not made again
  });

  it('refuses the changes of anybody but the owner', async () => {
    const owner = await loginAs(OWNER);
    const id = Number(
      /\/groups\/(\d+)/.exec(String((await owner.post('/groups')).headers.location))![1],
    );
    const reader = await loginAs(READER);
    expect((await reader.post(`/groups/${id}/task`, { show: '1' })).headers.location).toBe('/403');
    const page = (await reader.get(`/groups/${id}`)).body;
    expect(page).toContain('Today Task');
    expect(page).not.toContain('g-task-show'); // read-only: no checkbox
  });
});

describe("multiple-events mode: the group's event", () => {
  it('switches the mode from the home page', async () => {
    const owner = await loginAs(OWNER);
    const res = await owner.post('/events-mode', { to: 'multiple' });
    expect(res.headers.location).toBe('/');
    expect(
      (
        await pool.query(
          'SELECT is_simple_events_model AS s FROM user_profiles WHERE user_id = $1',
          [await userId(OWNER)],
        )
      ).rows[0]!.s,
    ).toBe(false);
    expect((await owner.get('/')).body).toContain('My events');
  });

  it('creates events with the next free name', async () => {
    const owner = await loginAs(OWNER);
    await owner.post('/events');
    expect((await events(OWNER)).map((e) => e.name)).toEqual(['Event 01', 'Event 02']);
  });

  it('chooses an event, none, or a new one, and makes the chosen one the default', async () => {
    const owner = await loginAs(OWNER);
    const id = Number(
      /\/groups\/(\d+)/.exec(String((await owner.post('/groups')).headers.location))![1],
    );
    const [first, second] = await events(OWNER);
    const page = (await owner.get(`/groups/${id}`)).body;
    expect(page).toContain('Create a new event and use it');
    expect(page).toContain(`value="${second!.id}"`);
    await owner.post(`/groups/${id}/event`, { event: String(second!.id) });
    expect((await groupEvent(id)).event_id).toBe(second!.id);
    expect(await defaultEvent(OWNER)).toBe(second!.id);
    await owner.post(`/groups/${id}/event`, { event: '0' });
    expect((await groupEvent(id)).event_id).toBeNull();
    await owner.post(`/groups/${id}/event`, { event: '-1' });
    const all = await events(OWNER);
    expect(all.map((e) => e.name)).toEqual(['Event 01', 'Event 02', 'Event 03']);
    expect((await groupEvent(id)).event_id).toBe(all[2]!.id);
    expect(first!.id).not.toBe(all[2]!.id);
  });

  it("refuses somebody else's event and leaves the group as it was", async () => {
    const other = await loginAs(OTHER);
    await other.post('/events-mode', { to: 'multiple' });
    await other.post('/events');
    const [theirs] = await events(OTHER);
    const owner = await loginAs(OWNER);
    const id = Number(
      /\/groups\/(\d+)/.exec(String((await owner.post('/groups')).headers.location))![1],
    );
    const before = await groupEvent(id);
    const res = await owner.post(`/groups/${id}/event`, { event: String(theirs!.id) });
    expect(res.statusCode).toBe(302);
    expect(await groupEvent(id)).toEqual(before);
    expect((await owner.post(`/groups/${id}/event`, { event: 'x' })).statusCode).toBe(302); // not a number: nothing changes either
    expect(await groupEvent(id)).toEqual(before);
  });

  it('switches back to the single-event mode', async () => {
    const owner = await loginAs(OWNER);
    await owner.post('/events-mode', { to: 'single' });
    expect((await owner.get('/')).body).toContain('Having more than one competition');
  });
});
