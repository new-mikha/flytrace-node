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

// The event page (/events/:id): the Today Task editor (rows of waypoint + radius), in the multiple-events mode the name and
// Delete, and "Old points removal". Where the waypoints themselves are edited is not built yet.
import type { CurrentUser } from '../auth/service.ts';
import { DEFAULT_RADIUS, MAX_RADIUS, type EditableEvent } from '../repo/eventEditor.ts';
import { ConfirmDialog, confirmAttrs, confirmDeleteEvent } from './confirmDelete.tsx';
import { Alert, Field, Submit, type Flash } from './forms.tsx';
import { formatAge, formatTimestamp } from './format.ts';
import { Layout } from './Layout.tsx';

/** What was typed into a form that was refused, to show it again with its message. */
export interface EventDraft {
  name?: { value: string; error: string };
  task?: { rows: Array<{ wpt: string; radius: string }>; error: string };
}

interface PageProps {
  user: CurrentUser;
  event: EditableEvent;
  /** The single-event mode has one "Today Task": no name, no delete. */
  single: boolean;
  flash?: Flash | null;
  draft?: EventDraft;
  now: Date;
}

const naturalByName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function TaskRow({ index, last, wpt, radius, options }: { index: number; last: boolean; wpt: string; radius: string; options: EditableEvent['waypoints'] }) {
  return (
    <tr class="ft-task-row">
      <th scope="row" class="ft-task-no">{last ? 'Add new ->' : index === 0 ? 'Start' : String(index)}</th>
      <td>
        <select class="form-select form-select-sm" name="wpt" aria-label="Turn point">
          <option value="" selected={wpt === ''}></option>
          {options.map((w) => <option key={w.id} value={String(w.id)} selected={String(w.id) === wpt}>{w.name}</option>)}
        </select>
      </td>
      <td>
        <input class="form-control form-control-sm" name="radius" inputmode="numeric" pattern="[0-9]{1,6}" maxlength={6} value={radius} aria-label="Radius in meters" />
      </td>
      <td class="text-end">
        <button class="btn btn-outline-secondary btn-sm ft-needs-js ft-task-remove" type="button" data-task-remove aria-label="Remove this point" title="Remove">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </td>
    </tr>
  );
}

function TaskEditor({ event, draft }: { event: EditableEvent; draft?: EventDraft['task'] }) {
  const options = [...event.waypoints].sort(naturalByName);
  const saved = event.task.map((p) => ({ wpt: String(p.waypointId), radius: String(p.radius) }));
  const rows = [...(draft?.rows ?? saved).filter((r) => r.wpt !== ''), { wpt: '', radius: String(DEFAULT_RADIUS) }];
  const initial = saved.map((r) => `${r.wpt}:${r.radius}`).join(',');
  return (
    <form id="ft-task-form" method="post" action={`/events/${event.id}/task`} class="ft-form" data-guard="changed" data-swap="ft-flash task"
          data-initial={initial} data-default-radius={String(DEFAULT_RADIUS)} data-wpts={JSON.stringify(event.waypoints)}>
      {draft?.error && <Alert flash={{ kind: 'danger', text: draft.error }} />}
      <div class="d-flex flex-wrap align-items-center gap-3 mb-3">
        <button class="btn btn-outline-secondary btn-sm ft-needs-js" type="button" data-task-clear>Clear task</button>
        <details class="ft-bulk ft-needs-js">
          <summary>Show bulk update controls</summary>
          <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
            <label class="form-label mb-0" for="ft-bulk-radius">Radius (meters)</label>
            <input class="form-control form-control-sm ft-bulk-radius" id="ft-bulk-radius" inputmode="numeric" value={String(DEFAULT_RADIUS)} />
            <button class="btn btn-outline-secondary btn-sm" type="button" data-task-bulk="name">Use all waypoints, sorted by name</button>
            <button class="btn btn-outline-secondary btn-sm" type="button" data-task-bulk="order">Use all waypoints, in the order added</button>
          </div>
        </details>
      </div>
      <table class="table table-sm align-middle ft-task-rows">
        <thead>
          <tr><th scope="col">Point #</th><th scope="col">Turn point</th><th scope="col">Radius (meters)</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <TaskRow key={i} index={i} last={i === rows.length - 1} wpt={r.wpt} radius={r.radius} options={options} />)}
        </tbody>
      </table>
      <p class="form-text">Pick a waypoint in the last line to add a point{' '}
        <span class="ft-no-js">(to take one out, choose the empty entry in its line)</span>. The radius is in meters, 1 to {MAX_RADIUS}.</p>
      <Submit>Save task</Submit>
    </form>
  );
}

function PostButton({ event, action, fields, kind = 'outline-secondary', children }:
  { event: EditableEvent; action: string; fields?: Record<string, string>; kind?: string; children: preact.ComponentChildren }) {
  return (
    <form method="post" action={`/events/${event.id}/${action}`} class="d-inline" data-swap="ft-flash old-points">
      {Object.entries(fields ?? {}).map(([name, value]) => <input type="hidden" name={name} value={value} />)}
      <button class={`btn btn-${kind}`} type="submit">{children}</button>
    </form>
  );
}

function OldPoints({ event, now }: { event: EditableEvent; now: Date }) {
  const since = event.startTs;
  return (
    <section class="ft-section" id="old-points">
      <h5 class="ft-section-title"><i class="fa-solid fa-broom ft-heading-icon" aria-hidden="true"></i> Old points removal <span class="ft-section-note">optional</span></h5>
      {since ? (
        <div class="alert alert-warning" role="status">
          <strong>Maps that show this event are hiding the old points now.</strong>{' '}
          The threshold is <strong>{formatAge(since, now).text}</strong>: only the points that appeared after{' '}
          <strong>{formatTimestamp(since, now)}</strong> are shown, which is <strong>{formatTimestamp(since, now, 'UTC')}</strong>.
        </div>
      ) : (
        <p class="text-body-secondary">Maps that show this event show every point, however old.</p>
      )}
      <p class="mb-2"><PostButton event={event} action="hide-old" fields={{ hours: '0' }}>Hide points older than now</PostButton></p>
      <p class="small text-body-secondary">
        Hides all the trackers on the maps of this event until new positions are received. That can be useful when only new positions make sense for the
        moment, e.g. at the beginning of the competition day: without such a clean-up a map can show points and tracks from previous days for a while,
        until the trackers are switched on, which could be annoying.
      </p>
      <details class="mb-3">
        <summary>Show additional clean-up controls...</summary>
        <div class="d-flex flex-wrap gap-2 mt-2">
          {[1, 2, 3, 5, 24].map((h) => (
            <PostButton key={h} event={event} action="hide-old" fields={{ hours: String(h) }}>Hide points older than now minus {h} hour{h === 1 ? '' : 's'}</PostButton>
          ))}
        </div>
      </details>
      <p class="mb-2"><PostButton event={event} action="restore-old">Restore old points</PostButton></p>
      <p class="small text-body-secondary mb-0">
        Brings back all the trackers on the maps of this event, however old their positions are. In other words, it cancels an earlier click on a
        "Hide points older than now" button.
      </p>
    </section>
  );
}

export function EventPage({ user, event, single, flash, draft, now }: PageProps) {
  const title = single ? 'Today task' : `'${event.name}' today task`;
  const none = event.waypoints.length === 0;
  return (
    <Layout title={title} user={user} path={`/events/${event.id}`} card="wide"
            scripts={['confirm-dialog.js', 'swap.js', 'task-editor.js', 'keep-scroll.js']}>
      <p class="mb-2"><a class="ft-group-link" href="/"><i class="fa-solid fa-arrow-left fa-xs" aria-hidden="true"></i> My groups</a></p>
      <div id="ft-head"><h1 class="h3 mb-3 ft-wrap">{title}</h1></div>
      <div id="ft-flash"><Alert flash={flash} /></div>
      <div class="ft-event-page">
        {!single && (
          <section class="ft-section" id="details">
            <h5 class="ft-section-title"><i class="fa-solid fa-flag-checkered ft-heading-icon" aria-hidden="true"></i> {event.name} details</h5>
            <form method="post" action={`/events/${event.id}`} class="ft-form" data-guard="changed" data-swap="ft-head ft-flash details">
              <Field name="name" label="Competition or fly-in name" value={draft?.name?.value ?? event.name} maxlength={256} error={draft?.name?.error} />
              <div class="d-flex flex-wrap gap-2">
                <Submit>Rename</Submit>
                <a class="btn btn-outline-danger" {...confirmAttrs(confirmDeleteEvent({ id: event.id, name: event.name, waypoints: event.waypoints.length, groups: event.groups }))}>
                  Delete the whole event
                </a>
              </div>
            </form>
            {event.isDefault && <p class="small text-body-secondary mt-3 mb-0">This is your default event: new pilot groups will use it.</p>}
          </section>
        )}
        <section class="ft-section" id="task">
          <h5 class="ft-section-title"><i class="fa-solid fa-route ft-heading-icon" aria-hidden="true"></i> Today Task</h5>
          <p class="mb-1"><strong>{event.waypoints.length}</strong> waypoint{event.waypoints.length === 1 ? ' is' : 's are'} available for the task.</p>
          {single && <p class="mb-1">After you save the task below it will be displayed on your maps.</p>}
          <p><a href={`/events/${event.id}/waypoints`}>Manage available waypoints (add new waypoints, edit etc)...</a></p>
          <hr />
          {none ? <p class="mb-0">There are no waypoints yet, so there is nothing to put in a task. Load the waypoints first.</p> : <TaskEditor event={event} draft={draft?.task} />}
        </section>
        <OldPoints event={event} now={now} />
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
