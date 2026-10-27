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
// `data-confirm-*` attributes (public/js/group-editor.js shows it in the dialog), and the confirmation page, which the same
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

export function confirmDeleteGroup(group: EditableGroup): ConfirmDelete {
  const n = group.trackers.length;
  return {
    title: 'Delete group', button: 'Delete group',
    action: `/groups/${group.id}/delete`, back: `/groups/${group.id}`,
    question: ['Delete the group ', { name: group.name }, n > 0 ? ` and its ${n} tracker${n === 1 ? '' : 's'}` : '',
               '? Its public map link stops working. This cannot be undone.'],
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

/** The confirmation page (what the Delete link opens without JavaScript). */
export function ConfirmDeletePage({ user, group, confirm, error }: { user: CurrentUser; group: EditableGroup; confirm: ConfirmDelete; error?: string }) {
  return (
    <Layout title={confirm.title} user={user} path={`/groups/${group.id}`} card>
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
