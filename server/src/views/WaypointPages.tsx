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

// The waypoints manager (/events/:id/waypoints): load a file, the table of the event's waypoints
// (sortable, edited in place, Delete through the dialog), and the form that adds one by hand.
// Coordinates are shown and typed in the format the person chose (decimal degrees, degrees and
// minutes, degrees minutes and seconds).
import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import {
  COORD_FORMATS,
  type CoordFormat,
  type CoordKind,
  coordFields,
  formatCoord,
} from '../geo/coords.ts';
import type { EditableEvent } from '../repo/eventEditor.ts';
import {
  type CoordPrefs,
  type ManagedWaypoint,
  type WaypointSort,
  type WaypointSortKey,
  DEFAULT_WAYPOINT_SORT,
} from '../repo/waypoints.ts';
import {
  confirmAttrs,
  confirmDeleteAllWaypoints,
  confirmDeleteWaypoint,
  ConfirmDialog,
} from './confirmDelete.tsx';
import { Alert, type Flash, Submit } from './forms.tsx';
import { Layout } from './Layout.tsx';

/** What was typed into a refused form, with the messages (keys: name, lat, lon, alt, description). */
export interface WaypointDraft {
  values: Record<string, string>;
  errors: Record<string, string>;
  /** The waypoint being edited; none: the add form. */
  editId?: number;
}

export interface WaypointsPageProps {
  user: CurrentUser;
  event: EditableEvent;
  single: boolean;
  waypoints: ManagedWaypoint[];
  prefs: CoordPrefs;
  sort: WaypointSort;
  /** The row open for editing without JavaScript (`?edit=`). */
  editId?: number;
  flash?: Flash | null;
  draft?: WaypointDraft;
}

const SORT_LABELS: Record<WaypointSortKey, string> = {
  name: 'Wpt Name',
  lat: 'Lat',
  lon: 'Lon',
  alt: 'Alt',
  description: 'Description',
};

export const waypointsHref = (eventId: number, sort: WaypointSort, hash = '', edit?: number) => {
  const params = new URLSearchParams();
  if (edit !== undefined) params.set('edit', String(edit));
  if (sort.key !== DEFAULT_WAYPOINT_SORT.key || sort.dir !== DEFAULT_WAYPOINT_SORT.dir) {
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  }
  const q = params.toString();
  return `/events/${eventId}/waypoints${q ? `?${q}` : ''}${hash}`;
};

function SortHeader({
  column,
  event,
  sort,
}: {
  column: WaypointSortKey;
  event: EditableEvent;
  sort: WaypointSort;
}) {
  const active = sort.key === column;
  const next: WaypointSort = {
    key: column,
    dir: active && sort.dir === 'asc' ? 'desc' : 'asc',
  };
  const icon = !active ? 'fa-sort' : sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <a class="ft-sort" href={waypointsHref(event.id, next, '#waypoints')}>
        {SORT_LABELS[column]}{' '}
        <i class={`fa-solid ${icon} ft-sort-icon${active ? ' active' : ''}`} aria-hidden="true"></i>
      </a>
    </th>
  );
}

const mapLink = (w: { lat: number; lon: number }) =>
  `https://www.google.com/maps?q=${w.lat},${w.lon}&z=10`;

/** 12.5 not 12.500000001: the altitude as typed, without float noise. */
const showAlt = (alt: number) => String(Number(alt.toFixed(2)));

function Unit({ children }: { children: ComponentChildren }) {
  return <span class="input-group-text">{children}</span>;
}

/**
 * The fields of one coordinate. Names: decimal degrees `lat`; otherwise `latH` (hemisphere), `latD`,
 * `latM` and, with seconds, `latS` (the same with `lon`). `values` holds what to show.
 */
function CoordInputs({
  kind,
  format,
  values,
  idPrefix,
  error,
  ns,
  ew,
}: {
  kind: CoordKind;
  format: CoordFormat;
  values: Record<string, string>;
  idPrefix: string;
  error?: string;
  ns: string;
  ew: string;
}) {
  const label = kind === 'lat' ? 'Latitude' : 'Longitude';
  const bad = error ? ' is-invalid' : '';
  const id = (suffix: string) => `${idPrefix}-${kind}${suffix}`;
  const num = (suffix: string, width: string, max: number, hint: string) => (
    <input
      class={`form-control${bad} ft-coord-${width}`}
      id={id(suffix)}
      name={`${kind}${suffix}`}
      value={values[`${kind}${suffix}`] ?? ''}
      inputmode="decimal"
      maxlength={max}
      required
      aria-label={`${label} ${hint}`}
    />
  );
  const hemispheres = kind === 'lat' ? ['N', 'S'] : ['E', 'W'];
  const chosen = values[`${kind}H`] || (kind === 'lat' ? ns : ew);
  return (
    <div class="mb-3">
      <label class="form-label" for={id(format === 'Deg' ? '' : 'D')}>
        {label}
      </label>
      <div class="input-group input-group-sm has-validation flex-nowrap">
        {format === 'Deg' ? (
          <input
            class={`form-control${bad}`}
            id={id('')}
            name={kind}
            value={values[kind] ?? ''}
            inputmode="decimal"
            maxlength={20}
            required
            aria-label={label}
            placeholder={kind === 'lat' ? '-27.15887' : '151.26354'}
          />
        ) : (
          <>
            <select
              class={`form-select${bad} ft-coord-h`}
              name={`${kind}H`}
              aria-label={`${label} hemisphere`}
            >
              {hemispheres.map((h) => (
                <option value={h} selected={h === chosen}>
                  {h}
                </option>
              ))}
            </select>
            {num('D', 'deg', 3, 'degrees')}
            <Unit>°</Unit>
            {num('M', 'min', format === 'DegMin' ? 7 : 2, 'minutes')}
            <Unit>'</Unit>
            {format === 'DegMinSec' && (
              <>
                {num('S', 'sec', 5, 'seconds')}
                <Unit>"</Unit>
              </>
            )}
          </>
        )}
        {error && <div class="invalid-feedback">{error}</div>}
      </div>
    </div>
  );
}

function TextField({
  idPrefix,
  name,
  label,
  value,
  error,
  required,
  maxlength,
  inputmode,
  help,
}: {
  idPrefix: string;
  name: string;
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  maxlength: number;
  inputmode?: 'decimal';
  help?: string;
}) {
  const id = `${idPrefix}-${name}`;
  return (
    <div class="mb-3">
      <label class="form-label" for={id}>
        {label}
      </label>
      <input
        class={`form-control form-control-sm${error ? ' is-invalid' : ''}`}
        id={id}
        name={name}
        value={value}
        maxlength={maxlength}
        required={required}
        inputmode={inputmode}
      />
      {error && <div class="invalid-feedback">{error}</div>}
      {help && !error && <div class="form-text">{help}</div>}
    </div>
  );
}

/** The fields shared by the add form and a row's edit form. */
function WaypointFields({
  idPrefix,
  values,
  errors,
  prefs,
}: {
  idPrefix: string;
  values: Record<string, string>;
  errors: Record<string, string>;
  prefs: CoordPrefs;
}) {
  return (
    <>
      <TextField
        idPrefix={idPrefix}
        name="name"
        label="Waypoint name"
        value={values.name ?? ''}
        error={errors.name}
        required
        maxlength={50}
      />
      <div class="row">
        <div class="col-md-6">
          <CoordInputs
            kind="lat"
            format={prefs.format}
            values={values}
            idPrefix={idPrefix}
            error={errors.lat}
            ns={prefs.ns}
            ew={prefs.ew}
          />
        </div>
        <div class="col-md-6">
          <CoordInputs
            kind="lon"
            format={prefs.format}
            values={values}
            idPrefix={idPrefix}
            error={errors.lon}
            ns={prefs.ns}
            ew={prefs.ew}
          />
        </div>
      </div>
      <div class="row">
        <div class="col-md-4">
          <TextField
            idPrefix={idPrefix}
            name="alt"
            label="Altitude (meters)"
            value={values.alt ?? ''}
            error={errors.alt}
            required
            maxlength={10}
            inputmode="decimal"
          />
        </div>
        <div class="col-md-8">
          <TextField
            idPrefix={idPrefix}
            name="description"
            label="Description (optional)"
            value={values.description ?? ''}
            error={errors.description}
            maxlength={500}
          />
        </div>
      </div>
    </>
  );
}

/** The values of the edit fields for a saved waypoint. */
export function waypointValues(w: ManagedWaypoint, format: CoordFormat): Record<string, string> {
  return {
    name: w.name,
    ...coordFields(w.lat, 'lat', format),
    ...coordFields(w.lon, 'lon', format),
    alt: showAlt(w.alt),
    description: w.description ?? '',
  };
}

function Row({
  w,
  event,
  prefs,
  sort,
}: {
  w: ManagedWaypoint;
  event: EditableEvent;
  prefs: CoordPrefs;
  sort: WaypointSort;
}) {
  return (
    <tr id={`wpt-${w.id}`}>
      <td class="fw-semibold ft-name-cell">
        <a href={mapLink(w)} target="_blank" rel="noopener" title="Show on Google Maps">
          {w.name}
        </a>
      </td>
      <td class="ft-card-full text-nowrap" data-label="Lat">
        {formatCoord(w.lat, 'lat', prefs.format)}
      </td>
      <td class="ft-card-full text-nowrap" data-label="Lon">
        {formatCoord(w.lon, 'lon', prefs.format)}
      </td>
      <td class="ft-card-stat" data-label="Alt">
        {showAlt(w.alt)}
      </td>
      <td class="ft-card-full text-body-secondary">{w.description}</td>
      <td class="ft-actions ft-card-link">
        <a
          href={waypointsHref(event.id, sort, `#wpt-${w.id}`, w.id)}
          data-wpt-edit
          class="text-nowrap"
        >
          Edit
        </a>
        <a
          class="text-danger text-nowrap"
          {...confirmAttrs(confirmDeleteWaypoint(event, w), true)}
          href={`/events/${event.id}/waypoints/${w.id}/delete`}
        >
          Delete
        </a>
      </td>
    </tr>
  );
}

function EditRow({
  w,
  event,
  prefs,
  sort,
  draft,
}: {
  w: ManagedWaypoint;
  event: EditableEvent;
  prefs: CoordPrefs;
  sort: WaypointSort;
  draft?: WaypointDraft;
}) {
  return (
    <tr id={`wpt-${w.id}`} class="ft-wpt-edit">
      <td colspan={6} class="ft-card-full">
        <form
          method="post"
          action={`/events/${event.id}/waypoints/${w.id}`}
          class="ft-form"
          data-guard="changed"
          data-swap="ft-flash waypoints"
        >
          <WaypointFields
            idPrefix={`edit-${w.id}`}
            values={draft?.values ?? waypointValues(w, prefs.format)}
            errors={draft?.errors ?? {}}
            prefs={prefs}
          />
          <div class="d-flex gap-2">
            <Submit>Update</Submit>
            <a
              class="btn btn-outline-secondary"
              href={waypointsHref(event.id, sort, '#waypoints')}
              data-wpt-cancel
            >
              Cancel
            </a>
          </div>
        </form>
      </td>
    </tr>
  );
}

function UploadSection({ event, prefs }: { event: EditableEvent; prefs: CoordPrefs }) {
  void prefs;
  return (
    <section class="ft-section" id="load">
      <h5 class="ft-section-title">
        <i class="fa-solid fa-file-arrow-up ft-heading-icon" aria-hidden="true"></i> Load waypoints
      </h5>
      <form
        method="post"
        action={`/events/${event.id}/waypoints/upload`}
        enctype="multipart/form-data"
        class="ft-form"
      >
        <input type="hidden" name="back" value="waypoints" />
        <div class="mb-2">
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              name="existing"
              id="ft-existing-skip"
              value="skip"
              checked
            />
            <label class="form-check-label" for="ft-existing-skip">
              Skip existing waypoints (matched by name)
            </label>
          </div>
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              name="existing"
              id="ft-existing-replace"
              value="replace"
            />
            <label class="form-check-label" for="ft-existing-replace">
              Replace existing waypoints (matched by name) with new data
            </label>
          </div>
        </div>
        <div class="mb-3">
          <label for="ft-wpt-file" class="form-label">
            This should be a Google Earth (*.KML), SeeYou (*.CUP) or GPS Exchange (*.GPX) file:
          </label>
          <input
            id="ft-wpt-file"
            class="form-control"
            type="file"
            name="file"
            accept=".kml,.cup,.gpx"
            required
            data-autosubmit
          />
        </div>
        <Submit>Load waypoints</Submit>
        <p class="mt-2 mb-0 text-body-secondary" data-uploading hidden>
          <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Uploading &amp; processing
          the file, please wait...
        </p>
      </form>
    </section>
  );
}

function FormatPicker({ event, prefs }: { event: EditableEvent; prefs: CoordPrefs }) {
  return (
    <form
      method="post"
      action={`/events/${event.id}/waypoints/format`}
      class="d-flex flex-wrap align-items-center gap-2 mb-3"
      data-swap="ft-flash waypoints add-waypoint"
    >
      <label class="form-label mb-0" for="ft-coord-format">
        Coordinates format:
      </label>
      <select
        class="form-select form-select-sm w-auto"
        id="ft-coord-format"
        name="format"
        data-autosubmit
      >
        {(Object.keys(COORD_FORMATS) as CoordFormat[]).map((f) => (
          <option value={f} selected={f === prefs.format}>
            {COORD_FORMATS[f]}
          </option>
        ))}
      </select>
      <noscript>
        <Submit>Use</Submit>
      </noscript>
    </form>
  );
}

export function WaypointsPage(p: WaypointsPageProps) {
  const { event, single, waypoints, prefs, sort, draft } = p;
  const title = single ? 'Available waypoints' : `Waypoints of '${event.name}'`;
  const editing = draft?.editId ?? p.editId;
  const addDraft = draft && draft.editId === undefined ? draft : undefined;
  const taskLink = single && waypoints.length > 0 && (
    <p class="mb-3">
      <a href={`/events/${event.id}`}>
        <i class="fa-solid fa-route" aria-hidden="true"></i> View/edit Today Task...
      </a>
    </p>
  );
  return (
    <Layout
      title={title}
      user={p.user}
      path={`/events/${event.id}/waypoints`}
      card="wide"
      scripts={['confirm-dialog.js', 'swap.js', 'waypoint-editor.js', 'keep-scroll.js']}
    >
      <p class="mb-2">
        <a class="ft-group-link" href={`/events/${event.id}`}>
          <i class="fa-solid fa-arrow-left fa-xs" aria-hidden="true"></i>{' '}
          {single ? 'Today Task' : event.name}
        </a>
      </p>
      <div id="ft-head">
        <h1 class="h3 mb-3 ft-wrap">{title}</h1>
      </div>
      <div id="ft-flash">
        <Alert flash={p.flash} />
      </div>
      {taskLink}
      <div class="ft-waypoints-page">
        <UploadSection event={event} prefs={prefs} />
        <section class="ft-section" id="waypoints">
          <h5 class="ft-section-title">
            <i class="fa-solid fa-location-dot ft-heading-icon" aria-hidden="true"></i>{' '}
            {single
              ? 'Waypoints available for Today Task'
              : `Waypoints available for '${event.name}'`}
          </h5>
          <FormatPicker event={event} prefs={prefs} />
          {waypoints.length === 0 ? (
            <p class="text-body-secondary">
              There are no waypoints at the moment. Use Upload command above, or Add Waypoint
              command below.
            </p>
          ) : (
            <>
              <div class="ft-table-wrap mb-3">
                <table class="table table-striped align-middle ft-table ft-cards mb-0">
                  <thead>
                    <tr>
                      {(['name', 'lat', 'lon', 'alt', 'description'] as const).map((c) => (
                        <SortHeader key={c} column={c} event={event} sort={sort} />
                      ))}
                      <th scope="col">
                        <span class="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {waypoints.map((w) =>
                      w.id === editing ? (
                        <EditRow
                          key={w.id}
                          w={w}
                          event={event}
                          prefs={prefs}
                          sort={sort}
                          draft={draft?.editId === w.id ? draft : undefined}
                        />
                      ) : (
                        <Row key={w.id} w={w} event={event} prefs={prefs} sort={sort} />
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <p class="small text-body-secondary">
                {waypoints.length} waypoint{waypoints.length === 1 ? '' : 's'}. A waypoint that is
                in the task cannot be deleted: take it out of the task first.
              </p>
              <p class="mb-0">
                <a
                  class="btn btn-outline-danger btn-sm"
                  {...confirmAttrs(confirmDeleteAllWaypoints(event, waypoints.length), true)}
                  href={`/events/${event.id}/waypoints/delete-all`}
                >
                  Delete all waypoints
                </a>
              </p>
            </>
          )}
        </section>
        <section class="ft-section" id="add-waypoint">
          <h5 class="ft-section-title">
            <i class="fa-solid fa-plus ft-heading-icon" aria-hidden="true"></i> Add waypoint
            manually
          </h5>
          <form
            method="post"
            action={`/events/${event.id}/waypoints`}
            class="ft-form"
            data-guard="changed"
            data-swap="ft-flash waypoints add-waypoint"
          >
            <WaypointFields
              idPrefix="add"
              values={addDraft?.values ?? {}}
              errors={addDraft?.errors ?? {}}
              prefs={prefs}
            />
            <Submit>Add waypoint</Submit>
          </form>
        </section>
      </div>
      {taskLink}
      <ConfirmDialog />
    </Layout>
  );
}
