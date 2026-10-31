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

// The event page (/events/:id): the Today Task editor, rename, delete and "old points removal"
// (against the dev database).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';

const run = Math.random().toString(36).slice(2, 8);
const OWNER = `__test_eowner_${run}`;
const OTHER = `__test_eother_${run}`;
const PASSWORD = 'correct horse';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

let app: FastifyInstance;
let pool: Pool;
let ipCounter = 1;

async function loginAs(username: string) {
  const ip = `10.7.0.${ipCounter++}`;
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
    raw: (url: string, headers: Record<string, string>, payload: string) =>
      app.inject({ method: 'POST', url, remoteAddress: ip, cookies, headers, payload }),
    post: (url: string, payload: Array<[string, string]> | Record<string, string> = {}) => {
      const body = new URLSearchParams();
      for (const [k, v] of Array.isArray(payload) ? payload : Object.entries(payload))
        body.append(k, v);
      return app.inject({
        method: 'POST',
        url,
        remoteAddress: ip,
        cookies,
        headers: FORM,
        payload: body.toString(),
      });
    },
  };
}

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  const hash = await hashPassword(PASSWORD);
  for (const name of [OWNER, OTHER])
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [name, hash]);
  app = await buildApp(config, pool);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username LIKE $1', [`__test_e%_${run}`]);
  await app.close();
});

const userId = async (name: string) =>
  (await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [name])).rows[0]!
    .id;

async function eventWithWaypoints(owner: string, name: string, wpts: string[]) {
  const {
    rows: [e],
  } = await pool.query<{ id: number }>(
    'INSERT INTO events (user_id, name) VALUES ($1, $2) RETURNING id',
    [await userId(owner), name],
  );
  const ids: number[] = [];
  for (const w of wpts) {
    const {
      rows: [r],
    } = await pool.query<{ id: number }>(
      'INSERT INTO waypoints (event_id, name, lat, lon, alt) VALUES ($1, $2, -30, 150, 100) RETURNING id',
      [e!.id, w],
    );
    ids.push(r!.id);
  }
  return { id: e!.id, wpts: ids };
}
const task = async (eventId: number) =>
  (
    await pool.query<{ waypoint_id: number; radius: number; wpt_order: number }>(
      `SELECT t.waypoint_id, t.radius, t.wpt_order FROM tasks t
        JOIN waypoints w ON w.id = t.waypoint_id WHERE w.event_id = $1 ORDER BY t.wpt_order`,
      [eventId],
    )
  ).rows;

describe('single-event mode: the Today Task', () => {
  it('makes the default event on /events/default and opens it without name or delete', async () => {
    const owner = await loginAs(OWNER);
    const res = await owner.get('/events/default');
    expect(res.statusCode).toBe(302);
    const page = (await owner.get(String(res.headers.location))).body;
    expect(page).toContain('<h1 class="h3 mb-3 ft-wrap">Today task</h1>');
    expect(page).not.toContain('Delete the whole event');
    // no waypoints yet: the page asks for a file first, instead of the task editor
    expect(page).toContain('Load waypoints first');
    expect(page).toContain('enctype="multipart/form-data"');
    expect(page).not.toContain('id="ft-task-form"');
    // the same event again:
    expect((await owner.get('/events/default')).headers.location).toBe(res.headers.location);
  });

  it('refuses to delete the Today Task', async () => {
    const owner = await loginAs(OWNER);
    const location = String((await owner.get('/events/default')).headers.location);
    await owner.post(`${location}/delete`);
    expect((await owner.get(location)).statusCode).toBe(200);
  });
});

describe('multiple-events mode: an event page', () => {
  it('is for the owner only', async () => {
    const owner = await loginAs(OWNER);
    await owner.post('/events-mode', { to: 'multiple' });
    const ev = await eventWithWaypoints(OWNER, 'Barraba', ['H4WYST', 'BARRAG', 'KELVNT']);
    const page = (await owner.get(`/events/${ev.id}`)).body;
    expect(page).toContain("'Barraba' today task");
    expect(page).toContain('Barraba details');
    expect(page).toContain('Delete the whole event');
    expect(page).toContain('<strong>3</strong> waypoints are available');
    expect(page).toContain('data-initial data-default-radius');
    expect((await (await loginAs(OTHER)).get(`/events/${ev.id}`)).statusCode).toBe(404);
    expect((await app.inject({ url: `/events/${ev.id}` })).headers.location).toMatch(/^\/login/);
    expect((await owner.get('/events/999999999')).statusCode).toBe(404);
    expect((await owner.get('/events/abc')).statusCode).toBe(404);
  });

  it('saves the task in order, replacing the old one, and bumps the groups that show it', async () => {
    const owner = await loginAs(OWNER);
    const ev = await eventWithWaypoints(OWNER, 'Task test', ['A', 'B', 'C']);
    const {
      rows: [g],
    } = await pool.query<{ id: number }>(
      'INSERT INTO groups (name, user_id, event_id) VALUES ($1, $2, $3) RETURNING id',
      [`G ${run}`, await userId(OWNER), ev.id],
    );
    const version = async () =>
      (await pool.query<{ version: number }>('SELECT version FROM groups WHERE id = $1', [g!.id]))
        .rows[0]!.version;
    const before = await version();
    const [a, b, c] = ev.wpts as [number, number, number];
    let res = await owner.post(`/events/${ev.id}/task`, [
      ['wpt', String(c)],
      ['radius', '5000'],
      ['wpt', ''],
      ['radius', '77'],
      ['wpt', String(a)],
      ['radius', ''],
      ['wpt', ''],
      ['radius', '400'],
    ]);
    expect(res.statusCode).toBe(302);
    expect(await task(ev.id)).toEqual([
      { waypoint_id: c, radius: 5000, wpt_order: 0 },
      {
        waypoint_id: a,
        radius: 400,
        wpt_order: 1,
      },
    ]); // the empty line went, no radius = 400
    expect(await version()).toBe(before + 1);
    expect((await owner.get(`/events/${ev.id}`)).body).toContain(
      `data-initial="${c}:5000,${a}:400"`,
    );
    res = await owner.post(`/events/${ev.id}/task`, [
      ['wpt', String(b)],
      ['radius', '1'],
    ]);
    expect(await task(ev.id)).toEqual([{ waypoint_id: b, radius: 1, wpt_order: 0 }]);
    await owner.post(`/events/${ev.id}/task`, [
      ['wpt', ''],
      ['radius', '400'],
    ]);
    expect(await task(ev.id)).toEqual([]); // an empty task
  });

  it('refuses a bad radius, a foreign waypoint and nonsense, and keeps the task', async () => {
    const owner = await loginAs(OWNER);
    const ev = await eventWithWaypoints(OWNER, 'Refuse test', ['A']);
    const theirs = await eventWithWaypoints(OTHER, 'Not mine', ['X']);
    await owner.post(`/events/${ev.id}/task`, [
      ['wpt', String(ev.wpts[0])],
      ['radius', '300'],
    ]);
    for (const [wpt, radius, text] of [
      [String(ev.wpts[0]), '0', 'whole number of meters'],
      [String(ev.wpts[0]), '12ab', 'whole number of meters'],
      [String(ev.wpts[0]), '100001', 'whole number of meters'],
      [String(theirs.wpts[0]), '400', 'waypoints of this event'],
      ['abc', '400', 'from the lists'],
    ] as const) {
      const res = await owner.post(`/events/${ev.id}/task`, [
        ['wpt', wpt],
        ['radius', radius],
      ]);
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain(text);
    }
    expect(await task(ev.id)).toEqual([{ waypoint_id: ev.wpts[0], radius: 300, wpt_order: 0 }]);
    expect(await task(theirs.id)).toEqual([]);
  });

  it('renames, refusing a name already used', async () => {
    const owner = await loginAs(OWNER);
    const one = await eventWithWaypoints(OWNER, `Rename one ${run}`, []);
    await eventWithWaypoints(OWNER, `Rename two ${run}`, []);
    expect((await owner.post(`/events/${one.id}`, { name: `Rename two ${run}` })).statusCode).toBe(
      422,
    );
    expect((await owner.post(`/events/${one.id}`, { name: '  ' })).statusCode).toBe(422);
    expect((await owner.post(`/events/${one.id}`, { name: `Renamed ${run}` })).statusCode).toBe(
      302,
    );
    expect((await owner.get(`/events/${one.id}`)).body).toContain(`Renamed ${run} details`);
  });

  it('hides and restores old points, bumping the groups', async () => {
    const owner = await loginAs(OWNER);
    const ev = await eventWithWaypoints(OWNER, `Old points ${run}`, []);
    const startTs = async () =>
      (
        await pool.query<{ s: Date | null }>('SELECT start_ts AS s FROM events WHERE id = $1', [
          ev.id,
        ])
      ).rows[0]!.s;
    expect(await startTs()).toBeNull();
    expect((await owner.get(`/events/${ev.id}`)).body).toContain('show every point');
    const now = Date.now();
    await owner.post(`/events/${ev.id}/hide-old`, { hours: '2' });
    const since = (await startTs())!.getTime();
    expect(Math.abs(since - (now - 2 * 3_600_000))).toBeLessThan(10_000);
    expect((await owner.get(`/events/${ev.id}`)).body).toContain('are hiding the old points now');
    await owner.post(`/events/${ev.id}/hide-old`, { hours: '7' }); // not one of the buttons
    expect((await startTs())!.getTime()).toBe(since);
    await owner.post(`/events/${ev.id}/restore-old`);
    expect(await startTs()).toBeNull();
  });

  it('deletes the event after a confirmation page, and the groups that showed it show nothing', async () => {
    const owner = await loginAs(OWNER);
    const ev = await eventWithWaypoints(OWNER, `Doomed ${run}`, ['A']);
    const {
      rows: [g],
    } = await pool.query<{ id: number }>(
      'INSERT INTO groups (name, user_id, event_id) VALUES ($1, $2, $3) RETURNING id',
      [`GD ${run}`, await userId(OWNER), ev.id],
    );
    const confirm = (await owner.get(`/events/${ev.id}/delete`)).body;
    expect(confirm).toContain('Delete the event');
    expect(confirm).toContain('1 waypoint');
    expect(confirm).toContain('The group that shows it will show no task');
    expect((await (await loginAs(OTHER)).post(`/events/${ev.id}/delete`)).statusCode).toBe(404);
    expect((await owner.post(`/events/${ev.id}/delete`)).headers.location).toBe('/');
    expect((await pool.query('SELECT 1 FROM events WHERE id = $1', [ev.id])).rowCount).toBe(0);
    expect(
      (
        await pool.query<{ e: number | null }>('SELECT event_id AS e FROM groups WHERE id = $1', [
          g!.id,
        ])
      ).rows[0]!.e,
    ).toBeNull();
  });

  it('opens the home page list: Edit goes to the page and Create new event to its page', async () => {
    const owner = await loginAs(OWNER);
    const res = await owner.post('/events');
    expect(res.headers.location).toMatch(/^\/events\/\d+$/);
    expect((await owner.get(String(res.headers.location))).statusCode).toBe(200);
  });
});

function multipart(fileName: string, content: string, fields: Record<string, string> = {}) {
  const boundary = '----ftTestBoundary';
  let body = '';
  for (const [k, v] of Object.entries(fields))
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
  body += `Content-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body };
}

describe('loading waypoints from a file', () => {
  const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
    <Placemark><name>ZULU</name><description>last letter</description><Point><coordinates>150.5,-30.25,120</coordinates></Point></Placemark>
    <Placemark><name>alpha</name><Point><coordinates>151,-31,0</coordinates></Point></Placemark>
  </Document></kml>`;

  async function upload(
    who: Awaited<ReturnType<typeof loginAs>>,
    eventId: number,
    fileName: string,
    content: string,
    fields = {},
  ) {
    const m = multipart(fileName, content, fields);
    return who.raw(`/events/${eventId}/waypoints/upload`, m.headers, m.body);
  }

  it('is a page with the box when the event has no waypoints, and the task editor once it has', async () => {
    const owner = await loginAs(OWNER);
    await owner.post('/events-mode', { to: 'multiple' });
    const ev = await eventWithWaypoints(OWNER, `Upload ${run}`, []);
    const page = (await owner.get(`/events/${ev.id}`)).body;
    expect(page).toContain('Load waypoints first');
    expect(page).toContain(`action="/events/${ev.id}/waypoints/upload"`);
    expect(page).toContain('accept=".kml,.cup,.gpx"');
    expect(page).toContain('data-autosubmit');
    expect(page).toContain('Old points removal');

    const res = await upload(owner, ev.id, 'comp.kml', KML);
    expect(res.statusCode).toBe(302);
    const after = (await owner.get(`/events/${ev.id}`)).body;
    expect(after).toContain('Waypoints loaded: 2 added.');
    expect(after).not.toContain('Load waypoints first');
    expect(after).toContain('id="ft-task-form"');
    const { rows } = await pool.query<{
      name: string;
      lat: number;
      lon: number;
      alt: number;
      description: string | null;
    }>('SELECT name, lat, lon, alt, description FROM waypoints WHERE event_id = $1 ORDER BY id', [
      ev.id,
    ]);
    expect(rows).toEqual([
      { name: 'ZULU', lat: -30.25, lon: 150.5, alt: 120, description: 'last letter' },
      { name: 'alpha', lat: -31, lon: 151, alt: 0, description: null },
    ]); // in file order, so "the order added" is the file's
  });

  it('replaces waypoints with the same name (any case), or keeps them when asked to', async () => {
    const owner = await loginAs(OWNER);
    const ev = await eventWithWaypoints(OWNER, `Merge ${run}`, ['ALPHA']);
    const names = async () =>
      (
        await pool.query<{ name: string; alt: number }>(
          'SELECT name, alt FROM waypoints WHERE event_id = $1 ORDER BY id',
          [ev.id],
        )
      ).rows;
    await upload(owner, ev.id, 'a.kml', KML, { existing: 'skip' });
    expect(await names()).toEqual([
      { name: 'ALPHA', alt: 100 },
      { name: 'ZULU', alt: 120 },
    ]); // alpha kept as it was
    await upload(owner, ev.id, 'a.kml', KML);
    expect(await names()).toEqual([
      { name: 'alpha', alt: 0 },
      { name: 'ZULU', alt: 120 },
    ]); // replaced, same row
  });

  it('bumps the groups that show the event, and audits the counts only', async () => {
    const owner = await loginAs(OWNER);
    const ev = await eventWithWaypoints(OWNER, `Bump ${run}`, []);
    const {
      rows: [g],
    } = await pool.query<{ id: number }>(
      'INSERT INTO groups (name, user_id, event_id) VALUES ($1, $2, $3) RETURNING id',
      [`GU ${run}`, await userId(OWNER), ev.id],
    );
    const version = async () =>
      (await pool.query<{ version: number }>('SELECT version FROM groups WHERE id = $1', [g!.id]))
        .rows[0]!.version;
    const before = await version();
    await upload(owner, ev.id, 'a.kml', KML);
    expect(await version()).toBe(before + 1);
  });

  it('refuses what it cannot read, with the reason, and changes nothing', async () => {
    const owner = await loginAs(OWNER);
    const ev = await eventWithWaypoints(OWNER, `Refuse upload ${run}`, []);
    const count = async () =>
      (await pool.query('SELECT 1 FROM waypoints WHERE event_id = $1', [ev.id])).rowCount;
    for (const [file, content, text] of [
      ['a.txt', 'x', 'files are not supported for waypoints upload'],
      [
        'a.kml',
        '<kml><Placemark><name>X</name></Placemark></kml>',
        'Problem with X: At least one required value is absent (coordinates)',
      ],
      ['a.kml', '<kml><Placemark>', 'The file is not valid XML'],
      [
        'a.cup',
        'name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc\n"A",A,,3318.830X,14750.088E,227.0m,1,,,,\n',
        'with a correct hemisphere symbol',
      ],
      ['a.kml', '<kml></kml>', 'No waypoints found in the uploaded file.'],
    ] as const) {
      const res = await upload(owner, ev.id, file, content);
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain(text);
    }
    expect(await count()).toBe(0);
    const noFile = await owner.raw(
      `/events/${ev.id}/waypoints/upload`,
      { 'content-type': 'application/x-www-form-urlencoded' },
      '',
    );
    expect(noFile.statusCode).toBe(422);
    expect(noFile.body).toContain('No file loaded.');
  });

  it('is for the owner only', async () => {
    const ev = await eventWithWaypoints(OWNER, `Foreign upload ${run}`, []);
    expect((await upload(await loginAs(OTHER), ev.id, 'a.kml', KML)).statusCode).toBe(404);
    expect(
      (await pool.query('SELECT 1 FROM waypoints WHERE event_id = $1', [ev.id])).rowCount,
    ).toBe(0);
  });
});
