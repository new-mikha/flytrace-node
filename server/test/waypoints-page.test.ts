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

// The waypoints manager (/events/:id/waypoints), against the dev database.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const OWNER = `__test_wowner_${run}`;
const OTHER = `__test_wother_${run}`;
const PASSWORD = 'correct horse';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

let app: FastifyInstance;
let pool: Pool;
let ipCounter = 1;

async function loginAs(username: string) {
  const ip = `10.8.0.${ipCounter++}`;
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
  for (const name of [OWNER, OTHER]) {
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [name, hash]);
    // the multiple-events mode, so that any event of theirs can be opened
    await pool.query(
      `INSERT INTO user_profiles (user_id, is_simple_events_model)
       SELECT id, false FROM users WHERE username = $1`,
      [name],
    );
  }
  app = await buildApp(config, pool);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username LIKE $1', [`__test_w%_${run}`]);
  await app.close();
});

const userId = async (name: string) =>
  (await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [name])).rows[0]!
    .id;

async function makeEvent(owner: string, name: string) {
  const {
    rows: [e],
  } = await pool.query<{ id: number }>(
    'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
    [await userId(owner), name],
  );
  return e!.id;
}
const rows = async (eventId: number) =>
  (
    await pool.query<{
      id: number;
      name: string;
      lat: number;
      lon: number;
      alt: number;
      description: string | null;
    }>(
      'SELECT id, name, lat, lon, alt, description FROM waypoints WHERE event_id = $1 ORDER BY id',
      [eventId],
    )
  ).rows;
const setFormat = (owner: string, format: string) =>
  pool.query('UPDATE user_profiles SET coord_format = $2 WHERE user_id = $1', [
    userId(owner),
    format,
  ]);
const useFormat = async (owner: string, format: string) =>
  pool.query('UPDATE user_profiles SET coord_format = $2 WHERE user_id = $1', [
    await userId(owner),
    format,
  ]);
void setFormat;

describe('the page', () => {
  it('is for the owner only', async () => {
    const id = await makeEvent(OWNER, 'Owned');
    expect((await (await loginAs(OTHER)).get(`/events/${id}/waypoints`)).statusCode).toBe(404);
    expect((await (await loginAs(OWNER)).get(`/events/${id}/waypoints`)).statusCode).toBe(200);
    expect((await app.inject({ url: `/events/${id}/waypoints` })).statusCode).toBe(302);
  });

  it('says so when there are no waypoints, and lists them sorted otherwise', async () => {
    const id = await makeEvent(OWNER, 'Sorted');
    const owner = await loginAs(OWNER);
    expect((await owner.get(`/events/${id}/waypoints`)).body).toContain(
      'There are no waypoints at the moment',
    );
    for (const [n, lat] of [
      ['WPT10', -30],
      ['WPT2', -20],
      ['wpt1', -40],
    ] as const)
      await pool.query(
        'INSERT INTO waypoints (event_id, name, lat, lon, alt) VALUES ($1, $2, $3, 150, 10)',
        [id, n, lat],
      );
    const names = (html: string) =>
      [...html.matchAll(/title="Show on Google Maps">([^<]+)</g)].map((m) => m[1]);
    expect(names((await owner.get(`/events/${id}/waypoints`)).body)).toEqual([
      'wpt1',
      'WPT2',
      'WPT10',
    ]);
    expect(names((await owner.get(`/events/${id}/waypoints?sort=lat&dir=desc`)).body)).toEqual([
      'WPT2',
      'WPT10',
      'wpt1',
    ]);
    expect((await owner.get(`/events/${id}/waypoints`)).body).toContain(
      'https://www.google.com/maps?q=-40,150&amp;z=10',
    );
  });

  it('opens the edit form of one row with ?edit=', async () => {
    const id = await makeEvent(OWNER, 'Editable');
    await pool.query(
      'INSERT INTO waypoints (event_id, name, lat, lon, alt) VALUES ($1, $2, -26.06966, 151.5, 5)',
      [id, 'A'],
    );
    const [w] = await rows(id);
    const html = (await (await loginAs(OWNER)).get(`/events/${id}/waypoints?edit=${w!.id}`)).body;
    expect(html).toContain(`action="/events/${id}/waypoints/${w!.id}"`);
    expect(html).toContain('value="-26.06966"');
  });
});

describe('adding', () => {
  it('adds a waypoint typed in decimal degrees, trimmed, and keeps the leading zero', async () => {
    const id = await makeEvent(OWNER, 'Add');
    const owner = await loginAs(OWNER);
    const res = await owner.post(`/events/${id}/waypoints`, {
      name: '  Mt Dare  ',
      lat: '-26.06966',
      lon: '135.5',
      alt: '650',
      description: ' the hill ',
    });
    expect(res.statusCode).toBe(302);
    expect(await rows(id)).toMatchObject([
      { name: 'Mt Dare', lat: -26.06966, lon: 135.5, alt: 650, description: 'the hill' },
    ]);
  });

  it('adds in degrees and minutes, and remembers the hemispheres', async () => {
    const id = await makeEvent(OWNER, 'AddDM');
    await useFormat(OWNER, 'DegMin');
    const owner = await loginAs(OWNER);
    const res = await owner.post(`/events/${id}/waypoints`, {
      name: 'B',
      latH: 'S',
      latD: '33',
      latM: '18.830',
      lonH: 'W',
      lonD: '70',
      lonM: '30',
      alt: '1',
      description: '',
    });
    expect(res.statusCode).toBe(302);
    const [w] = await rows(id);
    expect(w!.lat).toBeCloseTo(-(33 + 18.83 / 60), 9);
    expect(w!.lon).toBeCloseTo(-70.5, 9);
    expect(w!.description).toBeNull();
    const {
      rows: [p],
    } = await pool.query(
      'SELECT def_hemisphere_ns AS ns, def_hemisphere_ew AS ew FROM user_profiles WHERE user_id = $1',
      [await userId(OWNER)],
    );
    expect(p).toEqual({ ns: 'S', ew: 'W' });
    expect((await owner.get(`/events/${id}/waypoints`)).body).toMatch(/<option value="S" selected/);
    await useFormat(OWNER, 'Deg');
  });

  it('refuses a duplicate name (any case), bad coordinates and a missing altitude', async () => {
    const id = await makeEvent(OWNER, 'Refuse');
    const owner = await loginAs(OWNER);
    const ok = { name: 'Dup', lat: '1', lon: '2', alt: '3', description: '' };
    expect((await owner.post(`/events/${id}/waypoints`, ok)).statusCode).toBe(302);
    const dup = await owner.post(`/events/${id}/waypoints`, { ...ok, name: 'dup' });
    expect(dup.statusCode).toBe(422);
    expect(dup.body).toContain("'dup' has already been used as a waypoint name");
    expect(
      (await owner.post(`/events/${id}/waypoints`, { ...ok, name: 'X', lat: '95' })).statusCode,
    ).toBe(422);
    expect(
      (await owner.post(`/events/${id}/waypoints`, { ...ok, name: 'X', alt: '' })).statusCode,
    ).toBe(422);
    expect((await owner.post(`/events/${id}/waypoints`, { ...ok, name: '' })).statusCode).toBe(422);
    expect(await rows(id)).toHaveLength(1);
  });

  it("refuses another person's event", async () => {
    const id = await makeEvent(OWNER, 'Mine');
    const other = await loginAs(OTHER);
    const res = await other.post(`/events/${id}/waypoints`, {
      name: 'X',
      lat: '1',
      lon: '2',
      alt: '3',
    });
    expect(res.statusCode).toBe(404);
    expect(await rows(id)).toHaveLength(0);
  });

  it('bumps the version of the groups that show the event', async () => {
    const id = await makeEvent(OWNER, 'Bump');
    const {
      rows: [g],
    } = await pool.query<{ id: number; version: number }>(
      `INSERT INTO groups (user_id, name, event_id) VALUES ($1, 'Bump group', $2) RETURNING id, version`,
      [await userId(OWNER), id],
    );
    await (
      await loginAs(OWNER)
    ).post(`/events/${id}/waypoints`, { name: 'A', lat: '1', lon: '2', alt: '3' });
    const {
      rows: [after],
    } = await pool.query<{ version: number }>('SELECT version FROM groups WHERE id = $1', [g!.id]);
    expect(after!.version).toBeGreaterThan(g!.version);
  });
});

describe('refused forms', () => {
  it('flag only the fields at fault and keep what was typed', async () => {
    const id = await makeEvent(OWNER, 'Flags');
    const owner = await loginAs(OWNER);
    const typed = { name: 'Good name', lat: '95', lon: '10', alt: '5', description: 'kept' };
    const html = (await owner.post(`/events/${id}/waypoints`, typed)).body;
    expect(html.match(/is-invalid/g)).toHaveLength(1);
    expect(html).toContain('Latitude should be from -90 to 90 degrees');
    expect(html).toContain('value="Good name"');
    expect(html).toContain('value="kept"');
    expect(await rows(id)).toHaveLength(0);
    // a correct form is not flagged at all
    const ok = await owner.post(`/events/${id}/waypoints`, { ...typed, lat: '-26.06966' });
    expect(ok.statusCode).toBe(302);
    expect((await rows(id))[0]!.lat).toBe(-26.06966);
  });
});

describe('the highlight', () => {
  it('marks the row just added once, and the waypoints the task uses', async () => {
    const id = await makeEvent(OWNER, 'Hl');
    const owner = await loginAs(OWNER);
    await owner.post(`/events/${id}/waypoints`, { name: 'A', lat: '1', lon: '2', alt: '0' });
    await owner.post(`/events/${id}/waypoints`, { name: 'B', lat: '1', lon: '2', alt: '0' });
    const html = (await owner.get(`/events/${id}/waypoints`)).body;
    const [b] = await pool
      .query<{ id: number }>('SELECT id FROM waypoints WHERE event_id = $1 AND name = $2', [
        id,
        'B',
      ])
      .then((r) => r.rows);
    expect(html).toContain(`<tr id="wpt-${b!.id}" class="ft-wpt-new">`);
    expect(html.match(/ft-wpt-new/g)).toHaveLength(1);
    // not on the next visit (a reload forgets it)
    expect((await owner.get(`/events/${id}/waypoints`)).body).not.toContain('ft-wpt-new');
    // a waypoint in the task is shaded
    const [a] = await pool
      .query<{ id: number }>('SELECT id FROM waypoints WHERE event_id = $1 AND name = $2', [
        id,
        'A',
      ])
      .then((r) => r.rows);
    await pool.query('INSERT INTO tasks (waypoint_id, radius, wpt_order) VALUES ($1, 400, 0)', [
      a!.id,
    ]);
    expect((await owner.get(`/events/${id}/waypoints`)).body).toContain(
      `<tr id="wpt-${a!.id}" class="ft-wpt-used"`,
    );
  });
});

describe('updating and deleting', () => {
  async function seeded(name: string) {
    const id = await makeEvent(OWNER, name);
    for (const n of ['A', 'B'])
      await pool.query(
        'INSERT INTO waypoints (event_id, name, lat, lon, alt) VALUES ($1, $2, 1, 2, 3)',
        [id, n],
      );
    return { id, w: await rows(id) };
  }

  it('updates a waypoint and refuses a name another one has', async () => {
    const { id, w } = await seeded('Upd');
    const owner = await loginAs(OWNER);
    const res = await owner.post(`/events/${id}/waypoints/${w[0]!.id}`, {
      name: 'A2',
      lat: '-0.05',
      lon: '2',
      alt: '7.5',
      description: 'd',
    });
    expect(res.statusCode).toBe(302);
    expect((await rows(id))[0]).toMatchObject({
      name: 'A2',
      lat: -0.05,
      alt: 7.5,
      description: 'd',
    });
    const clash = await owner.post(`/events/${id}/waypoints/${w[0]!.id}`, {
      name: 'b',
      lat: '1',
      lon: '2',
      alt: '3',
    });
    expect(clash.statusCode).toBe(422);
    expect((await rows(id))[0]!.name).toBe('A2');
  });

  it('does not touch a waypoint of another event', async () => {
    const { id } = await seeded('Mine2');
    const { w } = await seeded('Mine3');
    const owner = await loginAs(OWNER);
    await owner.post(`/events/${id}/waypoints/${w[0]!.id}`, {
      name: 'Hacked',
      lat: '1',
      lon: '2',
      alt: '3',
    });
    expect(
      (
        await rows(
          w[0]!.id
            ? (
                await pool.query<{ event_id: number }>(
                  'SELECT event_id FROM waypoints WHERE id = $1',
                  [w[0]!.id],
                )
              ).rows[0]!.event_id
            : 0,
        )
      )[0]!.name,
    ).toBe('A');
  });

  it('deletes a waypoint, but not one the task uses', async () => {
    const { id, w } = await seeded('Del');
    await pool.query('INSERT INTO tasks (waypoint_id, radius, wpt_order) VALUES ($1, 400, 0)', [
      w[0]!.id,
    ]);
    const owner = await loginAs(OWNER);
    const refused = await owner.post(`/events/${id}/waypoints/${w[0]!.id}/delete`);
    expect(refused.statusCode).toBe(302);
    expect(await rows(id)).toHaveLength(2);
    expect((await owner.get(`/events/${id}/waypoints`)).body).toContain(
      "Cannot delete the waypoint 'A' because it's used in the task",
    );
    await owner.post(`/events/${id}/waypoints/${w[1]!.id}/delete`);
    expect((await rows(id)).map((r) => r.name)).toEqual(['A']);
  });

  it('asks before deleting (the page without JavaScript)', async () => {
    const { id, w } = await seeded('Ask');
    const html = (await (await loginAs(OWNER)).get(`/events/${id}/waypoints/${w[0]!.id}/delete`))
      .body;
    expect(html).toContain('Are you certain you want to delete the waypoint');
    expect(await rows(id)).toHaveLength(2);
  });

  it('deletes all the waypoints and the task with them', async () => {
    const { id, w } = await seeded('All');
    await pool.query('INSERT INTO tasks (waypoint_id, radius, wpt_order) VALUES ($1, 400, 0)', [
      w[0]!.id,
    ]);
    const owner = await loginAs(OWNER);
    expect((await owner.get(`/events/${id}/waypoints/delete-all`)).body).toContain(
      'ALL LOADED WAYPOINTS',
    );
    await owner.post(`/events/${id}/waypoints/delete-all`);
    expect(await rows(id)).toHaveLength(0);
    expect(
      (await pool.query('SELECT 1 FROM tasks WHERE waypoint_id = ANY($1)', [w.map((x) => x.id)]))
        .rowCount,
    ).toBe(0);
  });
});

describe('the coordinates format', () => {
  it('is saved and used for the table', async () => {
    const id = await makeEvent(OWNER, 'Fmt');
    await pool.query(
      'INSERT INTO waypoints (event_id, name, lat, lon, alt) VALUES ($1, $2, -33.313833, 151.5, 3)',
      [id, 'A'],
    );
    const owner = await loginAs(OWNER);
    await owner.post(`/events/${id}/waypoints/format`, { format: 'DegMin' });
    expect((await owner.get(`/events/${id}/waypoints`)).body).toContain("S\u00A033°\u00A018.830'");
    expect(
      (await owner.post(`/events/${id}/waypoints/format`, { format: 'bogus' })).statusCode,
    ).toBe(302);
    await owner.post(`/events/${id}/waypoints/format`, { format: 'Deg' });
    expect((await owner.get(`/events/${id}/waypoints`)).body).toContain('-33.31383');
  });
});

describe('/events/default/waypoints', () => {
  it('opens the manager of the default event in the single-event mode', async () => {
    await pool.query('UPDATE user_profiles SET is_simple_events_model = true WHERE user_id = $1', [
      await userId(OWNER),
    ]);
    const owner = await loginAs(OWNER);
    const res = await owner.get('/events/default/waypoints');
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toMatch(/^\/events\/\d+\/waypoints$/);
    expect((await owner.get(String(res.headers.location))).body).toContain('Available waypoints');
    await pool.query('UPDATE user_profiles SET is_simple_events_model = false WHERE user_id = $1', [
      await userId(OWNER),
    ]);
  });
});
