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

// The group editor against the dev database (needs `npm run db:migrate`): owner changes, read-only viewers, tracker input rules.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Pool } from '../src/db.ts';
import { parseTrackerInput } from '../src/repo/trackerInput.ts';

const run = Math.random().toString(36).slice(2, 8);
const OWNER = `__test_gowner_${run}`;
const OTHER = `__test_gother_${run}`;
const ADMIN = `__test_gadmin_${run}`;
const READER = `__test_greader_${run}`;
const PASSWORD = 'correct horse';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const SPOT_ID = '0IkTi311YC6crmpNWFBxhrqIDojfU9JO6';

let app: FastifyInstance;
let pool: Pool;
let ipCounter = 1;

async function loginAs(username: string) {
  const ip = `10.8.0.${ipCounter++}`;
  const res = await app.inject({ method: 'POST', url: '/login', remoteAddress: ip, headers: FORM,
    payload: new URLSearchParams({ username, password: PASSWORD, returnUrl: '/' }).toString() });
  const cookie = res.cookies.find((c) => c.name === 'flytrace.sid');
  const cookies: Record<string, string> = cookie ? { [cookie.name]: cookie.value } : {};
  return {
    get: (url: string) => app.inject({ url, remoteAddress: ip, cookies }),
    post: (url: string, payload: Record<string, string | string[]> = {}) => {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(payload)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
      return app.inject({ method: 'POST', url, remoteAddress: ip, cookies, headers: FORM, payload: body.toString() });
    },
  };
}

beforeAll(async () => {
  const config = { ...loadConfig(), SMTP_HOST: undefined };
  pool = createPool(config.DATABASE_URL);
  const hash = await hashPassword(PASSWORD);
  for (const name of [OWNER, OTHER, ADMIN, READER]) await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [name, hash]);
  for (const [name, role] of [[ADMIN, 'Admins'], [READER, 'SpotIdReaders']]) {
    await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.username = $1 AND r.name = $2`, [name, role]);
  }
  app = await buildApp(config, pool);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE username LIKE $1', [`__test_g%_${run}`]);
  await app.close();
});

const groupRow = async (id: number) => (await pool.query('SELECT name, is_public, display_user_messages, version FROM groups WHERE id = $1', [id])).rows[0];
const trackerRows = async (id: number) => (await pool.query('SELECT id, name, tracker_type, foreign_id, is_on FROM group_trackers WHERE group_id = $1 ORDER BY id', [id])).rows;

async function newGroup(owner: ReturnType<typeof loginAs> extends Promise<infer T> ? T : never): Promise<number> {
  const res = await owner.post('/groups');
  expect(res.statusCode).toBe(302);
  return Number(/\/groups\/(\d+)/.exec(String(res.headers.location))![1]);
}

describe('parseTrackerInput', () => {
  it('recognizes SPOT ids and links', () => {
    expect(parseTrackerInput(SPOT_ID)).toEqual({ type: 'S', foreignId: SPOT_ID });
    expect(parseTrackerInput(` https://share.findmespot.com/shared/faces/viewspots.jsp?glId=${SPOT_ID} `)).toEqual({ type: 'S', foreignId: SPOT_ID });
  });
  it('recognizes inReach feeds, which need the IMEI after #', () => {
    expect(parseTrackerInput('https://aus.inreach.garmin.com/Feed/Share/Phillm#300434031769290'))
      .toEqual({ type: 'G', foreignId: 'share.garmin.com/Feed/Share/Phillm#300434031769290' });
    expect(parseTrackerInput('Phillm#300434031769290')).toMatchObject({ type: 'G' });
    expect(parseTrackerInput('Phillm')).toHaveProperty('error');
    expect(parseTrackerInput('garmin.com/Feed/Share/Phillm')).toHaveProperty('error');
  });
  it('follows the chosen type', () => {
    expect(parseTrackerInput(SPOT_ID, 'S')).toMatchObject({ type: 'S' });
    expect(parseTrackerInput('short', 'S')).toHaveProperty('error');
    expect(parseTrackerInput(`${SPOT_ID}#300434031769290`, 'G')).toMatchObject({ type: 'G' });
    expect(parseTrackerInput(SPOT_ID, 'G')).toHaveProperty('error'); // no IMEI
  });
  it('refuses nonsense and overlong text', () => {
    expect(parseTrackerInput('a b c')).toHaveProperty('error');
    expect(parseTrackerInput('x'.repeat(500))).toHaveProperty('error');
  });
});

describe('creating and editing', () => {
  it('needs a login, then makes Group 01, Group 02 and opens the editor', async () => {
    expect((await app.inject({ method: 'POST', url: '/groups' })).headers.location).toMatch(/^\/login/);
    const owner = await loginAs(OWNER);
    const a = await newGroup(owner);
    const b = await newGroup(owner);
    expect((await groupRow(a)).name).toBe('Group 01');
    expect((await groupRow(b)).name).toBe('Group 02');
    const page = await owner.get(`/groups/${a}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Save settings');
    expect(page.body).toContain('Add a tracker');
    expect(page.body).toContain('Created');
  });

  it('saves the details, bumps the version and refuses an empty or taken name', async () => {
    const owner = await loginAs(OWNER);
    const id = await newGroup(owner);
    const other = await newGroup(owner);
    const v0 = (await groupRow(id)).version;
    const ok = await owner.post(`/groups/${id}`, { name: ' Fly-in ', visibility: 'public', messages: 'hide' });
    expect(ok.statusCode).toBe(302);
    expect(await groupRow(id)).toMatchObject({ name: 'Fly-in', is_public: true, display_user_messages: false, version: v0 + 1 });
    expect((await owner.post(`/groups/${id}`, { name: '  ', visibility: 'public', messages: 'show' })).statusCode).toBe(422);
    const taken = await owner.post(`/groups/${other}`, { name: 'Fly-in', visibility: 'public', messages: 'show' });
    expect(taken.statusCode).toBe(422);
    expect(taken.body).toContain('You already have a group named');
    expect((await owner.post(`/groups/${id}`, { name: 'X', visibility: 'maybe', messages: 'show' })).statusCode).toBe(422);
    expect((await groupRow(id)).name).toBe('Fly-in');
  });

  it("adds, renames, turns on and off, and deletes trackers", async () => {
    const owner = await loginAs(OWNER);
    const id = await newGroup(owner);
    const bad = await owner.post(`/groups/${id}/trackers`, { trackerName: 'Ann', link: 'Phillm' });
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('IMEI');
    expect((await owner.post(`/groups/${id}/trackers`, { trackerName: '', link: SPOT_ID })).statusCode).toBe(422);
    const wrong = await owner.post(`/groups/${id}/trackers`, { trackerName: 'Ann', link: SPOT_ID, type: 'G' });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.body).toContain('checked'); // the chosen type is kept
    expect((await owner.post(`/groups/${id}/trackers`, { trackerName: 'Ann', link: SPOT_ID, type: 'S' })).statusCode).toBe(302);
    expect((await owner.post(`/groups/${id}/trackers`, { trackerName: 'Bob', link: 'Phillm#300434031769290' })).statusCode).toBe(302);
    const sameName = await owner.post(`/groups/${id}/trackers`, { trackerName: 'Ann', link: 'Other#300434031769291' });
    expect(sameName.statusCode).toBe(422);
    expect(sameName.body).toContain('already has a pilot with such name');
    const sameFeed = await owner.post(`/groups/${id}/trackers`, { trackerName: 'Cy', link: SPOT_ID });
    expect(sameFeed.body).toContain('This tracker is already in the group');
    const [ann, bob] = await trackerRows(id);
    expect(ann).toMatchObject({ name: 'Ann', tracker_type: 'S', foreign_id: SPOT_ID, is_on: true });
    expect(bob).toMatchObject({ tracker_type: 'G', foreign_id: 'share.garmin.com/Feed/Share/Phillm#300434031769290' });

    // Every row carries its (hidden) rename form for the script to swap in; `?rename=` shows one without JavaScript.
    const plain = (await owner.get(`/groups/${id}`)).body;
    expect(plain.match(/class="ft-rename-form" hidden/g)).toHaveLength(2);
    expect(plain.match(/data-confirm-action="\/groups\/\d+\/trackers\/\d+\/delete"/g)).toHaveLength(2); // Delete opens the dialog (id="ft-confirm") with the script
    expect(plain).toMatch(/id="ft-confirm" tabindex="-1"/i); // the dialog Bootstrap opens
    const home = (await owner.get('/')).body; // the group list's Delete opens the same dialog
    expect(home).toContain(`data-confirm-action="/groups/${id}/delete"`);
    expect(home).toContain('id="ft-confirm"');
    expect(home).toContain('/assets/js/confirm-dialog.js');
    for (const part of ['id="ft-head"', 'id="ft-flash"', 'id="trackers"', 'id="add-tracker"']) expect(plain).toContain(part); // what group-editor.js swaps
    expect(plain.match(/data-guard="changed"/g)).toHaveLength(5); // settings, on/off, the task and the two rename forms: their buttons wait for a change
    expect(plain).not.toContain('data-guard="filled"'); // the add form needs no marker: guard.js waits for its required fields
    const renaming = (await owner.get(`/groups/${id}?rename=${ann.id}`)).body;
    expect(renaming.match(/class="ft-rename-form" hidden/g)).toHaveLength(1);
    expect(renaming).toContain('Update');
    expect((await owner.post(`/groups/${id}/trackers/${ann.id}/rename`, { name: 'Bob' })).statusCode).toBe(422);
    expect((await owner.post(`/groups/${id}/trackers/${ann.id}/rename`, { name: 'Anna' })).statusCode).toBe(302);
    expect((await trackerRows(id))[0].name).toBe('Anna');

    // "Turn the trackers on & off": the page has the checkboxes (shown by the script, or by ?onoff=1), Save sends the checked ones.
    const closed = (await owner.get(`/groups/${id}`)).body;
    expect(closed).toContain('Turn the trackers on &amp; off');
    expect(closed).not.toContain('data-selecting');
    expect(closed.match(/class="form-check-input ft-check"/g)).toHaveLength(2);
    expect((await owner.get(`/groups/${id}?onoff=1`)).body).toContain('data-selecting="true"');
    const off = await owner.post(`/groups/${id}/trackers/on-off`, { on: String(bob.id) });
    expect(off.statusCode).toBe(302);
    expect((await trackerRows(id)).map((t) => t.is_on)).toEqual([false, true]);
    expect((await owner.get(`/groups/${id}`)).body).toContain('ft-tracker-off');
    await owner.post(`/groups/${id}/trackers/on-off`, { on: [String(ann.id), String(bob.id), '999999999'] }); // a stranger's id is ignored
    expect((await trackerRows(id)).map((t) => t.is_on)).toEqual([true, true]);
    await owner.post(`/groups/${id}/trackers/on-off`); // nothing checked: all off
    expect((await trackerRows(id)).map((t) => t.is_on)).toEqual([false, false]);

    expect((await owner.get(`/groups/${id}/trackers/${bob.id}/delete`)).body).toContain('Delete tracker');
    await owner.post(`/groups/${id}/trackers/${bob.id}/delete`);
    expect((await trackerRows(id)).map((t) => t.name)).toEqual(['Anna']);
  });

  it('asks the same question in the dialog and on the confirmation page', async () => {
    const owner = await loginAs(OWNER);
    const id = await newGroup(owner);
    await owner.post(`/groups/${id}/trackers`, { trackerName: 'Ann', link: SPOT_ID });
    const tid = (await trackerRows(id))[0].id;
    const editor = (await owner.get(`/groups/${id}`)).body;
    const dialogText = (action: string) => new RegExp(`data-confirm-action="${action}"[^>]*?data-confirm-text="([^"]*)"`).exec(editor)?.[1];
    const pageText = async (url: string) => /<p>(.*?)<\/p>/.exec((await owner.get(url)).body)?.[1]?.replace(/<\/?strong>/g, '');
    for (const url of [`/groups/${id}/trackers/${tid}/delete`, `/groups/${id}/delete`]) {
      expect(dialogText(url)).toBeTruthy();
      expect(await pageText(url)).toBe(dialogText(url));
    }
  });

  it('deletes a group after confirmation, with its trackers', async () => {
    const owner = await loginAs(OWNER);
    const id = await newGroup(owner);
    await owner.post(`/groups/${id}/trackers`, { trackerName: 'Ann', link: SPOT_ID });
    expect((await owner.get(`/groups/${id}/delete`)).body).toContain('cannot be undone');
    expect((await owner.post(`/groups/${id}/delete`)).headers.location).toBe('/');
    expect(await groupRow(id)).toBeUndefined();
    expect(await trackerRows(id)).toEqual([]);
    expect((await owner.get(`/groups/${id}`)).statusCode).toBe(404);
  });
});

describe('who may open a group', () => {
  it('shows admins and SpotIdReaders members a read-only page, and refuses every change', async () => {
    const owner = await loginAs(OWNER);
    const id = await newGroup(owner);
    await owner.post(`/groups/${id}/trackers`, { trackerName: 'Ann', link: SPOT_ID });
    const tid = (await trackerRows(id))[0].id;
    for (const who of [ADMIN, READER]) {
      const viewer = await loginAs(who);
      const res = await viewer.get(`/groups/${id}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(OWNER);
      expect(res.body).toContain(SPOT_ID); // they see the tracker ids
      expect(res.body).not.toContain('Save settings');
      expect(res.body).not.toContain('Add a tracker');
      expect(res.body).not.toContain('Rename');
      expect(res.body).not.toContain("ft-check"); // no checkboxes, no on/off button
      for (const url of [`/groups/${id}`, `/groups/${id}/delete`, `/groups/${id}/trackers`, `/groups/${id}/trackers/on-off`,
                         `/groups/${id}/trackers/${tid}/rename`, `/groups/${id}/trackers/${tid}/delete`]) {
        expect((await viewer.post(url, { name: 'Hacked', visibility: 'public', messages: 'show', trackerName: 'X', link: SPOT_ID })).headers.location).toBe('/403');
      }
      expect((await viewer.get(`/groups/${id}/delete`)).headers.location).toBe('/403');
    }
    expect(await groupRow(id)).toMatchObject({ is_public: false });
    expect((await trackerRows(id)).map((t) => t.name)).toEqual(['Ann']);
  });

  it('refuses anybody else, and anonymous visitors go to the login', async () => {
    const owner = await loginAs(OWNER);
    const id = await newGroup(owner);
    const other = await loginAs(OTHER);
    expect((await other.get(`/groups/${id}`)).headers.location).toBe('/403');
    expect((await other.post(`/groups/${id}/delete`)).headers.location).toBe('/403');
    expect((await app.inject({ url: `/groups/${id}` })).headers.location).toMatch(/^\/login/);
    expect(await groupRow(id)).toBeDefined();
    expect((await other.get('/groups/999999999')).statusCode).toBe(404);
    expect((await other.get('/groups/abc')).statusCode).toBe(404);
  });
});
