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

// The task editor of the event page: rows of waypoint + radius. The server renders the saved rows
// and one empty line at the end ("Add new ->"), which is all that is needed without JavaScript (the
// line of a point is cleared by choosing the empty entry). With it:
//  - choosing a waypoint in the last line adds another empty line; a Remove button takes a line
//    out; Clear task empties the table;
//  - the bulk controls fill the table with every waypoint of the event, sorted by name or in the
//    order added, with one radius;
//  - the Save button waits for a change: this answers guard.js (event `ft-changed`) by comparing
//    the lines with `data-initial`.
// Everything is delegated from <main>, so it keeps working when swap.js replaces the section. The
// server checks it all again.
(() => {
  const main = document.querySelector('main');
  if (!main) return;
  // shows what needs this script (Remove, Clear task, bulk controls)
  document.documentElement.classList.add('ft-js');
  const closest = (event, selector) =>
    event.target instanceof Element ? event.target.closest(selector) : null;
  const rowsOf = (form) => [...form.querySelectorAll('tbody tr')];
  const radiusOf = (row) => row.querySelector('input[name="radius"]');
  const wptOf = (row) => row.querySelector('select[name="wpt"]');

  function blank(row, form) {
    wptOf(row).value = '';
    radiusOf(row).value = form.dataset.defaultRadius;
  }

  // Whatever was changed: one empty line at the end, the numbers right, the guard told.
  function tidy(form) {
    const body = form.querySelector('tbody');
    let rows = rowsOf(form);
    if (rows.length === 0 || wptOf(rows[rows.length - 1]).value !== '') {
      const line = rows.length > 0 ? rows[rows.length - 1].cloneNode(true) : null;
      if (line) {
        blank(line, form);
        body.append(line);
      }
      rows = rowsOf(form);
    }
    rows.forEach((row, i) => {
      const last = i === rows.length - 1;
      row.querySelector('th').textContent = last ? 'Add new ->' : i === 0 ? 'Start' : String(i);
      // nothing to remove in the empty line
      row.querySelector('.ft-task-remove').style.display = last ? 'none' : '';
    });
    window.ftGuard?.();
  }

  function fill(form, points, radius) {
    const rows = rowsOf(form);
    const template = rows[rows.length - 1];
    for (const row of rows.slice(0, -1)) row.remove();
    blank(template, form);
    for (const p of points) {
      const line = template.cloneNode(true);
      wptOf(line).value = String(p.id);
      radiusOf(line).value = radius;
      template.before(line);
    }
    tidy(form);
  }

  main.addEventListener('change', (event) => {
    const select = closest(event, '#ft-task-form select[name="wpt"]');
    if (!select) return;
    const form = select.form;
    const row = select.closest('tr');
    if (select.value === '' && row !== rowsOf(form).pop()) row.remove(); // an emptied line goes
    tidy(form);
  });

  main.addEventListener('click', (event) => {
    const button = closest(event, '[data-task-remove], [data-task-clear], [data-task-bulk]');
    const form = button?.closest('#ft-task-form');
    if (!button || !form || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation(); // the page-wide handler in app.js has nothing to do for these
    if (button.hasAttribute('data-task-remove')) {
      const row = button.closest('tr');
      row.remove();
      tidy(form);
    } else if (button.hasAttribute('data-task-clear')) {
      fill(form, [], form.dataset.defaultRadius);
    } else {
      const typed = form.querySelector('#ft-bulk-radius').value.trim();
      const radius =
        /^\d{1,6}$/.test(typed) && Number(typed) > 0 ? typed : form.dataset.defaultRadius;
      const all = JSON.parse(form.dataset.wpts || '[]');
      // "In the order added" is by id (the order the waypoints were created), whatever order the
      // page listed them in.
      if (button.dataset.taskBulk === 'name')
        all.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
        );
      else all.sort((a, b) => a.id - b.id);

      fill(form, all, radius);
    }
  });

  // guard.js asks whether the lines differ from the saved task.
  main.addEventListener('ft-changed', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'ft-task-form') return;
    const now = rowsOf(form)
      .filter((row) => wptOf(row).value !== '')
      .map(
        (row) => `${wptOf(row).value}:${radiusOf(row).value.trim() || form.dataset.defaultRadius}`,
      )
      .join(',');
    event.detail.changed = now !== (form.dataset.initial ?? '');
  });

  const form = document.getElementById('ft-task-form');
  if (form) tidy(form);
})();
