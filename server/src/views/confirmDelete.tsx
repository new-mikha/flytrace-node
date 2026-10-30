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

// What the group editor asks before deleting a tracker or the group, written once. The Delete link carries it as
// `data-confirm-*` attributes (public/js/confirm-dialog.js shows it in the dialog, `ConfirmDialog` below), and the confirmation page, which the same
// link opens without JavaScript, renders it as a page: so the wording cannot differ between the two.
import type { EditableGroup, GroupTracker } from '../repo/groupEditor.ts';
import type { CurrentUser } from '../auth/service.ts';
import { Alert, Submit } from './forms.tsx';
import { Layout } from './Layout.tsx';

export interface ConfirmDelete {
  title: string;
  button: string;
  /** Where the confirmation is posted; the link to the confirmation page is the same address. */
  action: string;
  /** Where "Cancel" goes. */
  back: string;
  /** The question: text, and `{ name }` for what the page shows in bold (the dialog shows plain text). */
  question: Array<string | { name: string }>;
}

export function confirmDeleteTracker(group: EditableGroup, t: GroupTracker): ConfirmDelete {
  return {
    title: 'Delete tracker', button: 'Delete tracker',
    action: `/groups/${group.id}/trackers/${t.id}/delete`, back: `/groups/${group.id}#trackers`,
    question: ['Remove ', { name: t.name }, ' from the group ', { name: group.name }, '?'],
  };
}

export function confirmDeleteGroup(group: { id: number; name: string }, n: number): ConfirmDelete {
  return {
    title: 'Delete group', button: 'Delete group',
    action: `/groups/${group.id}/delete`, back: `/groups/${group.id}`,
    question: ['Delete the group ', { name: group.name }, n > 0 ? ` and its ${n} tracker${n === 1 ? '' : 's'}` : '',
               '? Its public map link stops working. This cannot be undone.'],
  };
}

export function confirmDeleteEvent(event: { id: number; name: string; waypoints: number; groups: number }): ConfirmDelete {
  const w = event.waypoints;
  const g = event.groups;
  return {
    title: 'Delete event', button: 'Delete event',
    action: `/events/${event.id}/delete`, back: `/events/${event.id}`,
    question: ['Delete the event ', { name: event.name }, w > 0 ? ` and its ${w} waypoint${w === 1 ? '' : 's'}` : '',
               g > 0 ? `? ${g === 1 ? 'The group that shows it' : `The ${g} groups that show it`} will show no task.` : '?', ' This cannot be undone.'],
  };
}

/** The attributes that make a Delete link open the dialog. `swap`: the change is sent in place (a tracker) rather than posted. */
export function confirmAttrs(c: ConfirmDelete, swap = false) {
  return {
    href: c.action,
    'data-confirm-action': c.action,
    'data-confirm-title': c.title,
    'data-confirm-text': c.question.map((p) => (typeof p === 'string' ? p : p.name)).join(''),
    'data-confirm-button': c.button,
    ...(swap ? { 'data-confirm-swap': true } : {}),
  };
}

/** The one dialog of a page (a Bootstrap modal); public/js/confirm-dialog.js fills it from the Delete link that was clicked. */
export function ConfirmDialog() {
  return (
    <div class="modal fade" id="ft-confirm" tabIndex={-1} aria-labelledby="ft-confirm-title" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content" method="post" id="ft-confirm-form">
          <div class="modal-header">
            <h2 class="modal-title h5" id="ft-confirm-title">Delete</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body" id="ft-confirm-text"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Keep</button>
            <button type="submit" class="btn btn-danger" id="ft-confirm-button">Delete</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** The confirmation page (what the Delete link opens without JavaScript). */
export function ConfirmDeletePage({ user, path, confirm, error }: { user: CurrentUser; path: string; confirm: ConfirmDelete; error?: string }) {
  return (
    <Layout title={confirm.title} user={user} path={path} card>
      <h1 class="h3 mb-3"><i class="fa-solid fa-trash text-danger" aria-hidden="true"></i> {confirm.title}</h1>
      {error && <Alert flash={{ kind: 'danger', text: error }} />}
      <p>{confirm.question.map((p) => (typeof p === 'string' ? p : <strong>{p.name}</strong>))}</p>
      <form method="post" action={confirm.action} class="d-flex gap-2">
        <Submit kind="danger" icon="fa-solid fa-trash">{confirm.button}</Submit>
        <a class="btn btn-outline-secondary" href={confirm.back}>Cancel</a>
      </form>
    </Layout>
  );
}
