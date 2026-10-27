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

// The group editor (/groups/:id): the owner changes a group; admins and SpotIdReaders members may look at any group, read-only.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../audit.ts';
import { requireLogin } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import {
  addTracker, createGroup, deleteGroup, deleteTracker, getGroup, renameTracker, setTrackerOn, updateGroup, type EditableGroup,
} from '../repo/groupEditor.ts';
import { getSettings } from '../repo/settings.ts';
import { parseTrackerInput } from '../repo/trackerInput.ts';
import { DeleteGroupPage, DeleteTrackerPage, GroupPage, type GroupDraft } from '../views/GroupPages.tsx';
import { sendHtml } from '../views/render.tsx';
import { page } from './html.ts';
import { formFields, setFlash, takeFlash } from './util.ts';

const VIEWER_ROLES = ['Admins', 'SpotIdReaders'];
const ALTITUDE_LABEL = { none: 'not shown', ft: 'feet', m: 'kilometers' } as const;

export async function groupRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const guard = { preHandler: requireLogin };

  const notFound = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(404).type('text/html; charset=utf-8').send(page('Group not found', '<p>There is no such group.</p>', request.user ?? null));

  /** The group, when this person may see it (`write`: change it, i.e. is the owner). Otherwise the reply is already sent. */
  async function load(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, write: boolean)
    : Promise<{ group: EditableGroup; canEdit: boolean } | null> {
    const user = request.user!;
    const group = /^\d+$/.test(request.params.id) ? await getGroup(pool, Number(request.params.id)) : null;
    if (!group) { await notFound(request, reply); return null; }
    const canEdit = group.ownerId === user.id;
    if (canEdit || (!write && user.roles.some((r) => VIEWER_ROLES.includes(r)))) return { group, canEdit };
    audit(request, 'group.denied', 'Refused access to a group', { groupId: group.id, write });
    await reply.redirect('/403', 302);
    return null;
  }

  const back = (request: FastifyRequest, reply: FastifyReply, group: { id: number }, text: string, anchor = '') => {
    setFlash(request, 'success', text);
    return reply.redirect(`/groups/${group.id}${anchor}`, 302);
  };

  // "Create group": the next free "Group 01", "Group 02", ... and then straight to its editor.
  app.post('/groups', guard, async (request, reply) => {
    const user = request.user!;
    const settings = await getSettings(pool, user.id);
    const group = await createGroup(pool, user.id, settings.messagesByDefault === 'show');
    audit(request, 'group.created', 'Group created', { groupId: group.id, name: group.name });
    return back(request, reply, group, `Created "${group.name}". Give it a name, then add its trackers.`);
  });

  app.get<{ Params: { id: string }; Querystring: { rename?: string } }>('/groups/:id', guard, async (request, reply) => {
    const found = await load(request, reply, false);
    if (!found) return reply;
    const user = request.user!;
    const altitude = found.canEdit ? ALTITUDE_LABEL[(await getSettings(pool, user.id)).altitude] : undefined;
    const renaming = found.canEdit && /^\d+$/.test(request.query.rename ?? '') ? Number(request.query.rename) : null;
    return sendHtml(reply, <GroupPage user={user} {...found} flash={takeFlash(request)} altitude={altitude} renaming={renaming} />);
  });

  const show = (request: FastifyRequest, reply: FastifyReply, group: EditableGroup, draft: GroupDraft) =>
    sendHtml(reply, <GroupPage user={request.user!} group={group} canEdit draft={draft} />, 422);

  // The details form: name, visibility, owner-defined messages.
  app.post<{ Params: { id: string } }>('/groups/:id', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    const { group } = found;
    const f = formFields(request, 'name', 'visibility', 'messages');
    const name = f.name.trim();
    const isPublic = f.visibility === 'public';
    const showMessages = f.messages === 'show';
    const details = { name, isPublic, showMessages };
    if (!name) return show(request, reply, group, { details: { ...details, error: 'Enter a name for the group.' } });
    if (name.length > 256) return show(request, reply, group, { details: { ...details, error: 'The name is too long.' } });
    if (!['public', 'unlisted'].includes(f.visibility) || !['show', 'hide'].includes(f.messages)) {
      return show(request, reply, group, { details: { ...details, error: 'Please choose one of the options.' } });
    }
    if (!(await updateGroup(pool, group, details))) {
      return show(request, reply, group, { details: { ...details, error: `You already have a group named "${name}".` } });
    }
    audit(request, 'group.updated', 'Group details changed', {
      groupId: group.id, before: { name: group.name, isPublic: group.isPublic, showMessages: group.showMessages }, after: details,
    });
    return back(request, reply, group, 'Saved.');
  });

  app.get<{ Params: { id: string } }>('/groups/:id/delete', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    return sendHtml(reply, <DeleteGroupPage user={request.user!} group={found.group} />);
  });

  app.post<{ Params: { id: string } }>('/groups/:id/delete', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    await deleteGroup(pool, found.group.id);
    audit(request, 'group.deleted', 'Group deleted', { groupId: found.group.id, name: found.group.name, trackers: found.group.trackers.length });
    setFlash(request, 'success', `Deleted the group "${found.group.name}".`);
    return reply.redirect('/', 302);
  });

  app.post<{ Params: { id: string } }>('/groups/:id/trackers', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    const { group } = found;
    const f = formFields(request, 'trackerName', 'link', 'type');
    const name = f.trackerName.trim();
    const add = { name, link: f.link, type: f.type };
    if (!name) return show(request, reply, group, { add: { ...add, nameError: 'Enter the pilot name.' } });
    if (name.length > 50) return show(request, reply, group, { add: { ...add, nameError: 'The pilot name is too long (50 characters at most).' } });
    const parsed = parseTrackerInput(f.link, f.type === 'S' || f.type === 'G' ? f.type : undefined);
    if ('error' in parsed) return show(request, reply, group, { add: { ...add, linkError: parsed.error } });
    const dup = await addTracker(pool, group.id, name, parsed, f.link);
    if (dup === 'name') return show(request, reply, group, { add: { ...add, nameError: 'This group already has a pilot with such name.' } });
    if (dup === 'feed') return show(request, reply, group, { add: { ...add, linkError: 'This tracker is already in the group.' } });
    // The feed id is not logged: it is what the SpotIdReaders role guards.
    audit(request, 'tracker.added', 'Tracker added to a group', { groupId: group.id, pilot: name, trackerType: parsed.type });
    return back(request, reply, group, `Added ${name}.`, '#trackers');
  });

  // The switch on a tracker's row: it sends the state the person wants (`on=1` or `on=0`).
  app.post<{ Params: { id: string; tid: string } }>('/groups/:id/trackers/:tid/switch', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    const { group } = found;
    const tracker = /^\d+$/.test(request.params.tid) ? group.trackers.find((t) => t.id === Number(request.params.tid)) : undefined;
    if (!tracker) return notFound(request, reply);
    const on = formFields(request, 'on').on === '1';
    await setTrackerOn(pool, group.id, tracker.id, on);
    audit(request, 'tracker.switched', `Pilot switched ${on ? 'on' : 'off'}`, { groupId: group.id, trackerId: tracker.id, pilot: tracker.name, on });
    return reply.redirect(`/groups/${group.id}#tracker-${tracker.id}`, 302);
  });

  app.post<{ Params: { id: string; tid: string } }>('/groups/:id/trackers/:tid/rename', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    const { group } = found;
    const tracker = /^\d+$/.test(request.params.tid) ? group.trackers.find((t) => t.id === Number(request.params.tid)) : undefined;
    if (!tracker) return notFound(request, reply);
    const name = formFields(request, 'name').name.trim();
    const refuse = (error: string) => show(request, reply, group, { rename: { id: tracker.id, name, error } });
    if (!name) return refuse('Enter the pilot name.');
    if (name.length > 50) return refuse('The pilot name is too long (50 characters at most).');
    if (!(await renameTracker(pool, group.id, tracker.id, name))) return refuse('This group already has a pilot with such name.');
    audit(request, 'tracker.renamed', 'Pilot renamed', { groupId: group.id, trackerId: tracker.id, before: tracker.name, after: name });
    return back(request, reply, group, 'Saved.', '#trackers');
  });

  // Deleting a tracker has its own confirmation page (a link, so it works without JavaScript).
  const trackerOf = (group: EditableGroup, tid: string) => (/^\d+$/.test(tid) ? group.trackers.find((t) => t.id === Number(tid)) : undefined);

  app.get<{ Params: { id: string; tid: string } }>('/groups/:id/trackers/:tid/delete', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    const tracker = trackerOf(found.group, request.params.tid);
    if (!tracker) return notFound(request, reply);
    return sendHtml(reply, <DeleteTrackerPage user={request.user!} group={found.group} tracker={tracker} />);
  });

  app.post<{ Params: { id: string; tid: string } }>('/groups/:id/trackers/:tid/delete', guard, async (request, reply) => {
    const found = await load(request, reply, true);
    if (!found) return reply;
    const tracker = trackerOf(found.group, request.params.tid);
    if (!tracker) return notFound(request, reply);
    await deleteTracker(pool, found.group.id, tracker.id);
    audit(request, 'tracker.deleted', 'Tracker deleted from a group', { groupId: found.group.id, trackerId: tracker.id, pilot: tracker.name });
    return back(request, reply, found.group, `Deleted ${tracker.name}.`, '#trackers');
  });
}
