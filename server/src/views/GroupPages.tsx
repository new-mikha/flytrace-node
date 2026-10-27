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

import type { CurrentUser } from '../auth/service.ts';
import type { EditableGroup, GroupTracker } from '../repo/groupEditor.ts';
import { Alert, Field, Submit, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';

/** What the person typed into a form that was refused, to show it again with its message. */
export interface GroupDraft {
  details?: { name: string; isPublic: boolean; showMessages: boolean; error?: string };
  add?: { name: string; link: string; nameError?: string; linkError?: string };
  rename?: { id: number; name: string; error?: string };
}

interface PageProps {
  user: CurrentUser;
  group: EditableGroup;
  /** The owner changes things; an admin or a SpotIdReaders member only looks (the controls are shown as plain text). */
  canEdit: boolean;
  flash?: Flash | null;
  draft?: GroupDraft;
  /** The owner's altitude setting label, shown as information under the details (owner only). */
  altitude?: string;
  /** Tracker being renamed (`?rename=`), when no draft says so. */
  renaming?: number | null;
}

/** Link to the tracker's own page at SPOT or Garmin. */
function feedUrl(t: GroupTracker): string | null {
  if (t.type === 'S') return `https://share.findmespot.com/shared/faces/viewspots.jsp?glId=${encodeURIComponent(t.foreignId)}`;
  if (t.type === 'G') {
    const [feed, imei] = t.foreignId.split('#');
    return `https://${feed}${imei ? `?imei=${encodeURIComponent(imei)}` : ''}`;
  }
  return null;
}

/** inReach ids are shown short: the feed name and the IMEI. */
const shortId = (t: GroupTracker) => (t.type === 'G' ? t.foreignId.replace(/^.*\/Feed\/Share\//, '') : t.foreignId);

function TypeBadge({ type }: { type: GroupTracker['type'] }) {
  const label = type === 'S' ? 'SPOT' : type === 'G' ? 'inReach' : 'Test';
  return <span class={`badge ft-type-badge ft-type-${type}`} title={label}>{type === 'G' ? 'i' : type}<span class="visually-hidden"> {label}</span></span>;
}

function TrackerRow({ group, t, index, canEdit, rename }: { group: EditableGroup; t: GroupTracker; index: number; canEdit: boolean; rename?: GroupDraft['rename'] }) {
  const off = t.isOn ? '' : ' text-decoration-line-through text-body-secondary';
  const url = feedUrl(t);
  return (
    <tr>
      <td class="text-body-secondary">{index}</td>
      <td class={`text-center${off}`}>
        {canEdit
          ? <input class="form-check-input" type="checkbox" name="on" value={t.id} checked={t.isOn} form="ft-onoff-form" aria-label={`${t.name} on`} />
          : (t.isOn ? 'On' : 'Off')}
      </td>
      <td class={off}>
        {rename ? (
          <>
            <input class={`form-control form-control-sm${rename.error ? ' is-invalid' : ''}`} name="name" value={rename.name} maxlength={50} required
                   form="ft-rename-form" aria-label="Pilot name" autofocus />
            {rename.error && <div class="invalid-feedback d-block">{rename.error}</div>}
          </>
        ) : t.name}
      </td>
      <td class={`ft-tracker-id${off}`}>
        <TypeBadge type={t.type} />{' '}
        {url ? <a href={url} target="_blank" rel="noopener">{shortId(t)}</a> : shortId(t)}
      </td>
      {canEdit && (
        <td class="text-end text-nowrap ft-actions">
          {rename ? (
            <>
              <button class="btn btn-sm btn-primary" type="submit" form="ft-rename-form">Update</button>
              <a class="ft-group-link" href={`/groups/${group.id}#trackers`}>Cancel</a>
            </>
          ) : (
            <>
              <a class="ft-group-link" href={`/groups/${group.id}?rename=${t.id}#trackers`}>Rename</a>
              <a class="ft-danger-link" href={`/groups/${group.id}/trackers/${t.id}/delete`}>Delete</a>
            </>
          )}
        </td>
      )}
    </tr>
  );
}

function Details({ group, canEdit, draft }: { group: EditableGroup; canEdit: boolean; draft?: GroupDraft['details'] }) {
  const v = draft ?? { name: group.name, isPublic: group.isPublic, showMessages: group.showMessages };
  if (!canEdit) {
    return (
      <dl class="ft-group-facts mb-0">
        <dt>Group name</dt><dd>{group.name}</dd>
        <dt>Owner</dt><dd>{group.owner}</dd>
        <dt>Visibility</dt>
        <dd>{group.isPublic ? 'On the homepage: anyone can see its public map link there (when the group has 2 or more pilots).' : 'Unlisted: the map link is shared only with the people the owner wants to watch it.'}</dd>
        <dt>Owner-defined messages</dt><dd>{group.showMessages ? 'Shown' : 'Not shown'} for OK, CUSTOM and HELP markers.</dd>
      </dl>
    );
  }
  return (
    <form method="post" action={`/groups/${group.id}`} class="ft-form">
      <Field name="name" label="Group name" value={v.name} maxlength={256} error={draft?.error} />
      <fieldset class="mb-3">
        <legend class="form-label fs-6">How others discover the group</legend>
        <div class="form-check mb-2">
          <input class="form-check-input" type="radio" name="visibility" id="g-public" value="public" checked={v.isPublic} />
          <label class="form-check-label" for="g-public"><strong>On the homepage</strong>: anyone can see its public map link on the homepage.</label>
          <div class="form-text mt-0">The link is listed once the group has 2 or more pilots.</div>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="radio" name="visibility" id="g-unlisted" value="unlisted" checked={!v.isPublic} />
          <label class="form-check-label" for="g-unlisted"><strong>Unlisted</strong>: share the map link only with the people you want to watch it.</label>
          <div class="form-text mt-0">Site admins can see the group anyway.</div>
        </div>
      </fieldset>
      <fieldset class="mb-3">
        <legend class="form-label fs-6">Owner-defined messages for OK, CUSTOM and HELP markers</legend>
        <div class="form-check mb-2">
          <input class="form-check-input" type="radio" name="messages" id="g-msg-show" value="show" checked={v.showMessages} />
          <label class="form-check-label" for="g-msg-show"><strong>Show</strong> owner-defined messages for this group.</label>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="radio" name="messages" id="g-msg-hide" value="hide" checked={!v.showMessages} />
          <label class="form-check-label" for="g-msg-hide"><strong>Do not show</strong> owner-defined messages for this group.</label>
        </div>
      </fieldset>
      <Submit icon="fa-solid fa-check">Save details</Submit>
    </form>
  );
}

/** The group editor: details, the trackers (on/off, rename, delete) and the form to add one. Read-only for anybody but the owner. */
export function GroupPage({ user, group, canEdit, flash, draft, altitude, renaming }: PageProps) {
  const renameId = draft?.rename?.id ?? renaming ?? null;
  const add = draft?.add;
  return (
    <Layout title={group.name} user={user} path={`/groups/${group.id}`} card="wide">
      <p class="mb-2"><a class="ft-group-link" href="/"><i class="fa-solid fa-arrow-left fa-xs" aria-hidden="true"></i> My groups</a></p>
      <h1 class="h3 mb-3">
        {group.name}{' '}
        <a class="fs-6 ms-2 ft-group-link" href={`/map/${group.id}`} target="_blank" rel="noopener">
          Public map <i class="fa-solid fa-arrow-up-right-from-square fa-xs" aria-hidden="true"></i>
        </a>
      </h1>
      <Alert flash={flash} />
      {!canEdit && (
        <div class="alert alert-info" role="note">
          <i class="fa-solid fa-eye me-1" aria-hidden="true"></i> This group belongs to <strong>{group.owner}</strong>. You can look at it, but not change it.
        </div>
      )}
      <section class="ft-section">
        <h5 class="ft-section-title"><i class="fa-solid fa-sliders ft-heading-icon" aria-hidden="true"></i> Details</h5>
        <Details group={group} canEdit={canEdit} draft={draft?.details} />
        {canEdit && (
          <p class="mt-3 mb-0">
            <a class="btn btn-outline-danger btn-sm" href={`/groups/${group.id}/delete`}><i class="fa-solid fa-trash fa-fw" aria-hidden="true"></i> Delete the whole group</a>
          </p>
        )}
        {canEdit && altitude && (
          <p class="small text-body-secondary mt-3 mb-0">
            Altitude display: <strong>{altitude}</strong> for all your groups (change it in <a href="/settings/altitude">Settings</a>).
            Altitude is available only for selected tracker models, e.g. SPOT Gen3, and is sometimes missing even for those.
          </p>
        )}
      </section>

      <section class="ft-section" id="trackers">
        <h5 class="ft-section-title"><i class="fa-solid fa-location-dot ft-heading-icon" aria-hidden="true"></i> Trackers in the group</h5>
        {group.trackers.length === 0 ? <p class="text-body-secondary">The group has no trackers yet.</p> : (
          <div class="table-responsive">
            <table class="table table-striped align-middle ft-table mb-0">
              <caption class="visually-hidden">Trackers in the group</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col" class="text-center">On/Off</th>
                  <th scope="col">Pilot name</th>
                  <th scope="col">Tracker ID</th>
                  {canEdit && <th scope="col"><span class="visually-hidden">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {group.trackers.map((t, i) => (
                  <TrackerRow key={t.id} group={group} t={t} index={i + 1} canEdit={canEdit}
                              rename={renameId === t.id ? (draft?.rename ?? { id: t.id, name: t.name }) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && group.trackers.length > 0 && (
          <>
            <form id="ft-onoff-form" method="post" action={`/groups/${group.id}/trackers/on-off`} class="mt-3">
              <Submit kind="outline-primary" icon="fa-solid fa-power-off">Save on/off</Submit>
              <span class="small text-body-secondary ms-2">A tracker that is off is not drawn on the map unless it sends SOS or HELP.</span>
            </form>
            {renameId !== null && <form id="ft-rename-form" method="post" action={`/groups/${group.id}/trackers/${renameId}/rename`}></form>}
          </>
        )}
      </section>

      {canEdit && (
        <section class="ft-section" id="add-tracker">
          <h5 class="ft-section-title"><i class="fa-solid fa-plus ft-heading-icon" aria-hidden="true"></i> Add tracker to the group</h5>
          <form method="post" action={`/groups/${group.id}/trackers`} class="ft-form">
            <Field name="trackerName" label="Pilot name" value={add?.name ?? ''} maxlength={50} error={add?.nameError} />
            <Field name="link" label="SPOT or inReach page" value={add?.link ?? ''} maxlength={445} error={add?.linkError}
                   help={<>
                     SPOT shared page, or the SPOT ID part of the link, or the inReach KML feed or page, or the inReach ID part of the link.
                     For inReach, add the device's IMEI after a # sign. The type (SPOT or inReach) is told from what you enter.
                   </>} />
            <Submit icon="fa-solid fa-plus">Add tracker</Submit>
          </form>
        </section>
      )}
    </Layout>
  );
}

export function DeleteGroupPage({ user, group, error }: { user: CurrentUser; group: EditableGroup; error?: string }) {
  return (
    <Layout title="Delete group" user={user} path={`/groups/${group.id}`} card>
      <h1 class="h3 mb-3"><i class="fa-solid fa-trash text-danger" aria-hidden="true"></i> Delete group</h1>
      {error && <Alert flash={{ kind: 'danger', text: error }} />}
      <p>
        Delete the group <strong>{group.name}</strong>{group.trackers.length > 0 && <> and its {group.trackers.length} tracker{group.trackers.length === 1 ? '' : 's'}</>}?
        Its public map link stops working. This cannot be undone.
      </p>
      <form method="post" action={`/groups/${group.id}/delete`} class="d-flex gap-2">
        <Submit kind="danger" icon="fa-solid fa-trash">Delete group</Submit>
        <a class="btn btn-outline-secondary" href={`/groups/${group.id}`}>Cancel</a>
      </form>
    </Layout>
  );
}

export function DeleteTrackerPage({ user, group, tracker }: { user: CurrentUser; group: EditableGroup; tracker: GroupTracker }) {
  return (
    <Layout title="Delete tracker" user={user} path={`/groups/${group.id}`} card>
      <h1 class="h3 mb-3"><i class="fa-solid fa-trash text-danger" aria-hidden="true"></i> Delete tracker</h1>
      <p>Remove the pilot <strong>{tracker.name}</strong> from the group <strong>{group.name}</strong>?</p>
      <form method="post" action={`/groups/${group.id}/trackers/${tracker.id}/delete`} class="d-flex gap-2">
        <Submit kind="danger" icon="fa-solid fa-trash">Delete tracker</Submit>
        <a class="btn btn-outline-secondary" href={`/groups/${group.id}#trackers`}>Cancel</a>
      </form>
    </Layout>
  );
}
