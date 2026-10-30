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

// Group editor enhancements. Every control also works without this script (plain links and forms); with it:
//  - the SPOT / inReach radios follow the tracker link while it is typed, until the person picks one;
//  - Rename opens in the row itself (the server renders the form hidden in every row), Delete in the dialog of confirm-dialog.js;
//  - "Turn the trackers on & off" opens the checkboxes in place, with Select all, Select none and Cancel;
//  - (guard.js keeps the Save, Update and Add buttons disabled until the form holds something to send);
//  - the changes to the trackers (on/off, rename, add, delete) are sent with fetch (swap.js) and the parts of the page that changed
//    (the header, the message, the list, the add form) are swapped for those of the answer: no page load, no flicker.
// The server stays the only place with rules: it answers with the whole page (refused changes come back with their errors).
(() => {
  const main = document.querySelector('main');
  if (!main) return;
  document.documentElement.classList.add('ft-js'); // shows what needs this script (Select all / none)
  const closest = (event, selector) => (event.target instanceof Element ? event.target.closest(selector) : null);
  const plainClick = (event) => event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

  // ---- the type radios of the add form
  const SPOT = /^\s*(?:(?:https?:\/\/)?share\.findmespot\.com\/shared\/faces\/viewspots\.jsp\?glId=)?[^\s\\/?=&#]{20,50}\s*$/i;
  const guess = (text) => (/garmin\.com|#/i.test(text) ? 'G' : SPOT.test(text) ? 'S' : /\S/.test(text) ? 'G' : null);

  main.addEventListener('input', (event) => {
    const link = closest(event, '#ft-add-tracker input[name="link"]');
    if (!link) return;
    const form = link.form;
    const radios = [...form.querySelectorAll('input[name="type"]')];
    if (form.dataset.hand === undefined) form.dataset.hand = radios.some((r) => r.checked) ? '1' : '0';
    if (form.dataset.hand === '1') return;
    const type = guess(link.value);
    for (const r of radios) r.checked = r.value === type;
  });
  main.addEventListener('change', (event) => {
    const radio = closest(event, '#ft-add-tracker input[name="type"]');
    if (radio) radio.form.dataset.hand = '1';
  });

  // ---- Rename in the row: 'view' or 'rename'
  function rowMode(row, mode) {
    const rename = row.querySelector('.ft-rename-form');
    if (!rename) return; // a read-only row has none
    row.querySelector('.ft-tracker-name').hidden = mode === 'rename';
    row.querySelector('.ft-actions').hidden = mode !== 'view';
    rename.hidden = mode !== 'rename';
    const input = rename.querySelector('input[name="name"]');
    if (mode === 'rename') {
      input.focus();
      input.select();
    } else {
      input.value = rename.dataset.name; // what a cancelled edit left behind is dropped
      input.classList.remove('is-invalid');
      rename.querySelector('.invalid-feedback')?.remove();
    }
    window.ftGuard?.();
  }

  main.addEventListener('click', (event) => {
    const link = closest(event, 'a[data-rename], a[data-rename-cancel]');
    if (!link || !plainClick(event)) return;
    event.preventDefault();
    event.stopPropagation(); // the page-wide handler in app.js must not start a navigation for it
    const row = link.closest('.ft-tracker');
    for (const other of main.querySelectorAll('.ft-tracker')) if (other !== row) rowMode(other, 'view');
    rowMode(row, link.hasAttribute('data-rename') ? 'rename' : 'view');
  });

  // ---- "Turn the trackers on & off": the checkboxes are in the page, shown while #trackers has data-selecting
  const checks = () => [...main.querySelectorAll('#trackers .ft-check')];
  function selecting(on) {
    const section = document.getElementById('trackers');
    if (on) {
      section.setAttribute('data-selecting', 'true');
      checks()[0]?.focus();
    } else {
      section.removeAttribute('data-selecting');
      for (const c of checks()) c.checked = c.dataset.was === '1'; // what a cancelled selection left behind is dropped
      section.querySelector('.ft-onoff-start')?.focus();
    }
    window.ftGuard?.();
  }

  main.addEventListener('click', (event) => {
    const button = closest(event, '[data-onoff-start], [data-onoff-cancel], [data-onoff-all], [data-onoff-none]');
    if (!button || !plainClick(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.hasAttribute('data-onoff-start')) selecting(true);
    else if (button.hasAttribute('data-onoff-cancel')) selecting(false);
    else {
      for (const c of checks()) c.checked = button.hasAttribute('data-onoff-all');
      window.ftGuard?.();
    }
  });

  main.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = closest(event, '.ft-rename-form');
    if (open) rowMode(open.closest('.ft-tracker'), 'view');
    else if (closest(event, '#trackers[data-selecting]')) selecting(false);
  });

  // ---- Delete asks in a dialog (confirm-dialog.js opens it). A tracker's Delete carries `data-confirm-swap`: the dialog's form is
  // then sent like the other tracker changes; the group's is posted normally and the browser follows the redirect.
  const dialog = document.getElementById('ft-confirm');
  const dialogForm = document.getElementById('ft-confirm-form');
  if (dialog && dialogForm && window.bootstrap) {
    dialogForm.addEventListener('submit', (event) => {
      if (dialogForm.dataset.swap !== '1') return;
      event.preventDefault();
      event.stopPropagation();
      window.bootstrap.Modal.getInstance(dialog)?.hide();
      send(dialogForm);
    });
  }

  // ---- sending the changes (swap.js does the sending and the swapping; this knows where the cursor goes afterwards)
  const PARTS = ['ft-head', 'ft-flash', 'trackers', 'add-tracker'];

  async function send(form) {
    const rowId = form.closest('.ft-tracker')?.id;
    if (!(await window.ftSwap.send(form, PARTS))) return;
    const bad = main.querySelector('#trackers .ft-rename-form:not([hidden]) input, #add-tracker .is-invalid');
    const row = rowId ? document.getElementById(rowId) : null;
    if (bad) bad.focus();
    else if (form.id === 'ft-add-tracker') document.getElementById('f-trackerName')?.focus();
    else if (form.id === 'ft-onoff-form') document.querySelector('#trackers .ft-onoff-start')?.focus();
    else row?.querySelector('a[data-rename]')?.focus();
  }

  main.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.closest('#trackers, #add-tracker')) return;
    event.preventDefault();
    event.stopPropagation(); // app.js would show its own spinner and wait for a page that never loads
    send(form);
  });
})();
