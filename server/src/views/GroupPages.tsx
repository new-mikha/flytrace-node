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
import type { EditableGroup, GroupTaskInfo, GroupTracker } from '../repo/groupEditor.ts';
import { Alert, Field, Submit, type Flash } from './forms.tsx';
import { ConfirmDialog, confirmAttrs, confirmDeleteGroup, confirmDeleteTracker } from './confirmDelete.tsx';
import { Layout } from './Layout.tsx';

/** What the person typed into a form that was refused, to show it again with its message. */
export interface GroupDraft {
  details?: { name: string; isPublic: boolean; showMessages: boolean; error?: string };
  add?: { name: string; link: string; type?: string; nameError?: string; linkError?: string };
  rename?: { id: number; name: string; error?: string };
}

interface PageProps {
  user: CurrentUser;
  group: EditableGroup;
  /** The owner changes things; an admin or a SpotIdReaders member only looks (no controls at all, the values are plain text). */
  canEdit: boolean;
  /** The task of the group's map (what the owner's events mode makes of it). */
  task: GroupTaskInfo;
  flash?: Flash | null;
  draft?: GroupDraft;
  /** The owner's altitude setting, shown as information (owner only). */
  altitude?: string;
  /** Tracker being renamed (`?rename=`), when no draft says so. */
  renaming?: number | null;
  /** The on/off selection is open (`?onoff=1`, without JavaScript): the trackers show checkboxes. */
  selecting?: boolean;
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

/**
 * The On/Off cell: the state as a pill and, for the owner, a checkbox that replaces it while the trackers are being turned
 * on and off (`data-selecting` on #trackers, see the toolbar). The checkboxes belong to the form of that toolbar (`form=`),
 * as they sit inside the list, which has forms of its own.
 */
function Slot({ t, canEdit }: { t: GroupTracker; canEdit: boolean }) {
  return (
    <div class="ft-slot">
      <span class={`badge ft-status ${t.isOn ? 'text-bg-success' : 'text-bg-secondary'}`}>{t.isOn ? 'On' : 'Off'}</span>
      {canEdit && (
        <input class="form-check-input ft-check" type="checkbox" name="on" value={t.id} checked={t.isOn} data-was={t.isOn ? '1' : '0'}
               form="ft-onoff-form" aria-label={`${t.name} is on`} />
      )}
    </div>
  );
}

/** "Turn the trackers on & off", and while that is open: Save, Select all, Select none, Cancel (the legacy buttons). */
function OnOffTools({ group }: { group: EditableGroup }) {
  return (
    <div class="ft-onoff-tools">
      <a class="btn btn-outline-primary btn-sm ft-onoff-start" href={`/groups/${group.id}?onoff=1#trackers`} data-onoff-start>
        <i class="fa-solid fa-power-off fa-fw" aria-hidden="true"></i> Turn the trackers on &amp; off
      </a>
      <form id="ft-onoff-form" method="post" action={`/groups/${group.id}/trackers/on-off`} class="ft-onoff-bar" data-guard="changed">
        <button class="btn btn-primary btn-sm" type="submit">Save changes</button>
        <button class="btn btn-outline-secondary btn-sm ft-needs-js" type="button" data-onoff-all>Select all</button>
        <button class="btn btn-outline-secondary btn-sm ft-needs-js" type="button" data-onoff-none>Select none</button>
        <a class="btn btn-outline-secondary btn-sm" href={`/groups/${group.id}#trackers`} data-onoff-cancel>Cancel</a>
      </form>
    </div>
  );
}

function TrackerItem({ group, t, canEdit, rename }: { group: EditableGroup; t: GroupTracker; canEdit: boolean; rename?: GroupDraft['rename'] }) {
  const url = feedUrl(t);
  const muted = t.isOn ? '' : ' ft-tracker-off';
  return (
    <li class={`list-group-item ft-tracker${muted}`} id={`tracker-${t.id}`}>
      <Slot t={t} canEdit={canEdit} />
      <div class="ft-tracker-main">
        <div class="ft-tracker-name" hidden={!!rename}>{t.name}</div>
        {canEdit && (
          // Always in the page, hidden until Rename: public/js/group-editor.js swaps it with the name without a request.
          // Without JavaScript the Rename link reloads the page with `?rename=`, which renders it visible.
          <form method="post" action={`/groups/${group.id}/trackers/${t.id}/rename`} class="ft-rename-form" hidden={!rename} data-name={t.name} data-guard="changed">
            <div>
              <input class={`form-control form-control-sm${rename?.error ? ' is-invalid' : ''}`} name="name" value={rename?.name ?? t.name} maxlength={50} required
                     aria-label="Pilot name" autofocus={!!rename} />
              {rename?.error && <div class="invalid-feedback">{rename.error}</div>}
            </div>
            <button class="btn btn-sm btn-primary" type="submit">Update</button>
            <a class="btn btn-sm btn-outline-secondary" href={`/groups/${group.id}#tracker-${t.id}`} data-rename-cancel>Cancel</a>
          </form>
        )}
        <div class="ft-tracker-id small">
          <TypeBadge type={t.type} />{' '}
          {url ? <a href={url} target="_blank" rel="noopener">{shortId(t)}</a> : shortId(t)}
        </div>
      </div>
      {canEdit && (
        <div class="ft-actions text-nowrap" hidden={!!rename}>
          <a class="ft-group-link" href={`/groups/${group.id}?rename=${t.id}#tracker-${t.id}`} data-rename>Rename</a>
          {/* The link opens the confirmation page; with the script the data-confirm-* attributes fill the dialog instead. */}
          <a class="ft-danger-link" {...confirmAttrs(confirmDeleteTracker(group, t), true)}>Delete</a>
        </div>
      )}
    </li>
  );
}

function Facts({ group }: { group: EditableGroup }) {
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

function Choice({ name, value, id, checked, label, help }: { name: string; value: string; id: string; checked: boolean; label: string; help?: string }) {
  return (
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name={name} id={id} value={value} checked={checked} />
      <label class="form-check-label" for={id}><strong>{label}</strong></label>
      {help && <div class="form-text mt-0">{help}</div>}
    </div>
  );
}

function SettingsForm({ group, draft }: { group: EditableGroup; draft?: GroupDraft['details'] }) {
  const v = draft ?? { name: group.name, isPublic: group.isPublic, showMessages: group.showMessages };
  return (
    <form method="post" action={`/groups/${group.id}`} class="ft-form" data-guard="changed" data-swap="ft-head ft-flash settings">
      <Field name="name" label="Group name" value={v.name} maxlength={256} error={draft?.error} />
      <fieldset class="mb-3">
        <legend class="form-label fs-6">Who can find the map</legend>
        <Choice name="visibility" value="public" id="g-public" checked={v.isPublic} label="On the homepage"
                help="Anyone can see its public map link there, once the group has 2 or more pilots." />
        <Choice name="visibility" value="unlisted" id="g-unlisted" checked={!v.isPublic} label="Unlisted"
                help="Share the map link only with the people you want to watch it. Site admins can see it anyway." />
      </fieldset>
      <fieldset class="mb-3">
        <legend class="form-label fs-6">Owner-defined messages</legend>
        <Choice name="messages" value="show" id="g-msg-show" checked={v.showMessages} label="Show" help="Messages for OK, CUSTOM and HELP markers appear on this group's map." />
        <Choice name="messages" value="hide" id="g-msg-hide" checked={!v.showMessages} label="Do not show" />
      </fieldset>
      <Submit>Save settings</Submit>
    </form>
  );
}

/** Where the group's map gets its task from: the Today Task (single-event mode, a checkbox) or one of the owner's events (multiple-events mode, a choice). */
function TaskSection({ group, task, canEdit }: { group: EditableGroup; task: GroupTaskInfo; canEdit: boolean }) {
  const single = task.mode === 'single';
  const showing = single && task.eventId !== null && task.eventId === task.defaultEventId;
  const todayTask = (text: string) => (task.eventId === null ? text : <a href={`/events/${task.eventId}`}>{text}</a>);
  return (
    <section class="ft-section mt-4 ft-task" id="task">
      <h5 class="ft-section-title">
        <i class="fa-solid fa-flag-checkered ft-heading-icon" aria-hidden="true"></i> {single ? 'Task' : 'Event'}
        <span class="ft-section-note">optional</span>
      </h5>
      {single ? (
        <>
          <p class={canEdit ? 'text-body-secondary' : undefined}>
            {!showing ? "The group is not showing the Today Task on its map."
              : task.taskWaypoints > 1 ? <>The group is showing the {todayTask('Today Task')} on its map.</>
              : <>The group will show the {todayTask('Today Task')} on its map when the task is ready.</>}
          </p>
          {canEdit && (
            <form method="post" action={`/groups/${group.id}/task`} class="ft-form" data-guard="changed" data-swap="ft-flash task">
              <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" name="show" id="g-task-show" value="1" checked={showing} />
                <label class="form-check-label" for="g-task-show">Display the Today Task on the group's map</label>
              </div>
              <Submit>Save</Submit>
            </form>
          )}
        </>
      ) : (
        <>
          <p class={canEdit ? 'text-body-secondary' : undefined}>
            A task can be added to the group's map. It is the task of the event it uses:{' '}
            {task.eventName === null ? <strong>none</strong> : <a href={`/events/${task.eventId}`}><strong>{task.eventName}</strong></a>}.
          </p>
          {canEdit && (
            <form method="post" action={`/groups/${group.id}/event`} class="ft-form" data-guard="changed" data-swap="ft-flash task">
              <div class="mb-3">
                <label for="g-event" class="form-label">Use the task of</label>
                <select class="form-select" name="event" id="g-event">
                  <option value="0" selected={task.eventId === null}>None</option>
                  {task.events.map((e) => <option key={e.id} value={String(e.id)} selected={e.id === task.eventId}>{e.name}</option>)}
                  <option value="-1">Create a new event and use it</option>
                </select>
              </div>
              <Submit>Save</Submit>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function AddTracker({ group, add }: { group: EditableGroup; add?: GroupDraft['add'] }) {
  return (
    <form method="post" action={`/groups/${group.id}/trackers`} class="ft-form" id="ft-add-tracker">
      <Field name="trackerName" label="Pilot name" value={add?.name ?? ''} maxlength={50} error={add?.nameError} />
      <Field name="link" label="SPOT or inReach page" value={add?.link ?? ''} maxlength={445} error={add?.linkError}
             help="A SPOT shared page link or its ID, or an inReach KML feed link or its ID followed by # and the device's IMEI." />
      <fieldset class="mb-3">
        <legend class="form-label fs-6">Tracker type</legend>
        <div class="form-check form-check-inline">
          <input class="form-check-input" type="radio" name="type" id="g-type-s" value="S" checked={add?.type === 'S'} />
          <label class="form-check-label" for="g-type-s">SPOT</label>
        </div>
        <div class="form-check form-check-inline">
          <input class="form-check-input" type="radio" name="type" id="g-type-g" value="G" checked={add?.type === 'G'} />
          <label class="form-check-label" for="g-type-g">inReach</label>
        </div>
        <div class="form-text">Chosen for you as you type the link; change it if it is wrong.</div>
      </fieldset>
      <Submit icon="fa-solid fa-plus">Add tracker</Submit>
    </form>
  );
}

/**
 * The group editor. Wide screens: the group settings at the left, the trackers (switch, name, id, rename and delete on each
 * row) and under them the form for a new tracker at the right; phones stack them in that order. Anybody but the owner gets the same page read-only.
 */
export function GroupPage({ user, group, canEdit, task, flash, draft, altitude, renaming, selecting }: PageProps) {
  const renameId = draft?.rename?.id ?? renaming ?? null;
  const on = group.trackers.filter((t) => t.isOn).length;
  return (
    <Layout title={group.name} user={user} path={`/groups/${group.id}`} card="wide" scripts={canEdit ? ['confirm-dialog.js', 'swap.js', 'group-editor.js', 'keep-scroll.js'] : undefined}>
      <p class="mb-2"><a class="ft-group-link" href="/"><i class="fa-solid fa-arrow-left fa-xs" aria-hidden="true"></i> My groups</a></p>
      <div class="d-flex flex-wrap align-items-center gap-2 mb-3" id="ft-head">
        <h1 class="h3 mb-0 me-2 ft-wrap">{group.name}</h1>
        <span class={`badge ${group.isPublic ? 'text-bg-success' : 'text-bg-secondary'}`}>
          <i class={`fa-solid ${group.isPublic ? 'fa-house' : 'fa-eye-slash'} fa-xs`} aria-hidden="true"></i> {group.isPublic ? 'On the homepage' : 'Unlisted'}
        </span>
        <span class="badge ft-pilots">{group.trackers.length} {group.trackers.length === 1 ? 'pilot' : 'pilots'}</span>
        <a class="btn btn-outline-primary btn-sm ms-md-auto" href={`/map/${group.id}`} target="_blank" rel="noopener">
          Public map <i class="fa-solid fa-arrow-up-right-from-square fa-xs" aria-hidden="true"></i>
        </a>
      </div>
      <div id="ft-flash"><Alert flash={flash} /></div>
      {!canEdit && (
        <div class="alert alert-info" role="note">
          <i class="fa-solid fa-eye me-1" aria-hidden="true"></i> This group belongs to <strong>{group.owner}</strong>. You can look at it, but not change it.
        </div>
      )}
      <div class="row g-4">
        <div class="col-lg-5 ft-col-settings">
          <section class="ft-section" id="settings">
            <h5 class="ft-section-title"><i class="fa-solid fa-sliders ft-heading-icon" aria-hidden="true"></i> Group settings</h5>
            {canEdit ? <SettingsForm group={group} draft={draft?.details} /> : <Facts group={group} />}
            {canEdit && altitude && (
              <p class="small text-body-secondary mt-3 mb-0">
                Altitude: <strong>{altitude}</strong> on all your maps (<a href="/settings/altitude">change in Settings</a>). Not all trackers provide altitude.
              </p>
            )}
          </section>
          <TaskSection group={group} task={task} canEdit={canEdit} />
        </div>
        <div class="col-lg-7 ft-col-trackers">
          <section class="ft-section" id="trackers" data-selecting={selecting ? 'true' : undefined}>
            <h5 class="ft-section-title">
              <i class="fa-solid fa-location-dot ft-heading-icon" aria-hidden="true"></i> Trackers
              {group.trackers.length > 0 && <span class="ft-section-note">{on} of {group.trackers.length} on</span>}
            </h5>
            {canEdit && group.trackers.length > 0 && <OnOffTools group={group} />}
            {group.trackers.length === 0 ? (
              <p class="text-body-secondary mb-0">{canEdit ? 'No trackers yet. Add the first one with the form.' : 'The group has no trackers yet.'}</p>
            ) : (
              <ul class="list-group list-group-flush ft-trackers">
                {group.trackers.map((t) => (
                  <TrackerItem key={t.id} group={group} t={t} canEdit={canEdit}
                               rename={canEdit && renameId === t.id ? (draft?.rename ?? { id: t.id, name: t.name }) : undefined} />
                ))}
              </ul>
            )}
            {canEdit && group.trackers.length > 0 && (
              <p class="small text-body-secondary mt-2 mb-0">A tracker that is off is not drawn on the map unless it sends SOS or HELP.</p>
            )}
          </section>
          {canEdit && (
            <section class="ft-section" id="add-tracker">
              <h5 class="ft-section-title"><i class="fa-solid fa-plus ft-heading-icon" aria-hidden="true"></i> Add a tracker</h5>
              <AddTracker group={group} add={draft?.add} />
            </section>
          )}
        </div>
      </div>
      {canEdit && (
        <section class="ft-danger-zone mt-4">
          <div>
            <strong>Delete this group</strong>
            <div class="small text-body-secondary">Removes the group and its trackers; its public map link stops working.</div>
          </div>
          <a class="btn btn-outline-danger btn-sm" {...confirmAttrs(confirmDeleteGroup(group, group.trackers.length))}>
            <i class="fa-solid fa-trash fa-fw" aria-hidden="true"></i> Delete group
          </a>
        </section>
      )}
      {canEdit && <ConfirmDialog />}
    </Layout>
  );
}
