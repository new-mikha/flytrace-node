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
//  - Rename and Delete open in the row itself (the server renders both forms hidden in every row);
//  - the changes to the trackers (switch, rename, add, delete) are sent with fetch and the parts of the page that changed
//    (the header, the message, the list, the add form) are swapped for those of the answer: no page load, no flicker.
// The server stays the only place with rules: it answers with the whole page (refused changes come back with their errors).
(() => {
  const main = document.querySelector('main');
  if (!main) return;
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

  // ---- Rename and Delete in the row: 'view', 'rename' or 'delete'
  function rowMode(row, mode) {
    const rename = row.querySelector('.ft-rename-form');
    const remove = row.querySelector('.ft-delete-form');
    if (!rename || !remove) return; // read-only rows have neither
    row.querySelector('.ft-tracker-name').hidden = mode === 'rename';
    row.querySelector('.ft-actions').hidden = mode !== 'view';
    rename.hidden = mode !== 'rename';
    remove.hidden = mode !== 'delete';
    const input = rename.querySelector('input[name="name"]');
    if (mode === 'rename') {
      input.focus();
      input.select();
    } else {
      input.value = rename.dataset.name; // what a cancelled edit left behind is dropped
      input.classList.remove('is-invalid');
      rename.querySelector('.invalid-feedback')?.remove();
    }
    if (mode === 'delete') remove.querySelector('.btn-danger').focus();
  }

  main.addEventListener('click', (event) => {
    const link = closest(event, 'a[data-rename], a[data-rename-cancel], a[data-delete], a[data-delete-cancel]');
    if (!link || !plainClick(event)) return;
    event.preventDefault();
    event.stopPropagation(); // the page-wide handler in app.js must not start a navigation for it
    const row = link.closest('.ft-tracker');
    for (const other of main.querySelectorAll('.ft-tracker')) if (other !== row) rowMode(other, 'view');
    rowMode(row, link.hasAttribute('data-rename') ? 'rename' : link.hasAttribute('data-delete') ? 'delete' : 'view');
  });

  main.addEventListener('keydown', (event) => {
    const open = closest(event, '.ft-rename-form, .ft-delete-form');
    if (event.key === 'Escape' && open) rowMode(open.closest('.ft-tracker'), 'view');
  });

  // ---- sending the changes
  const PARTS = ['ft-head', 'ft-flash', 'trackers', 'add-tracker'];
  let sending = false;

  function say(text) {
    const box = document.getElementById('ft-flash');
    if (!box) return;
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.setAttribute('role', 'alert');
    alert.textContent = text;
    box.replaceChildren(alert);
  }

  async function send(form) {
    if (sending) return; // one change at a time, in the order the person made them
    sending = true;
    const rowId = form.closest('.ft-tracker')?.id;
    const isSwitch = form.classList.contains('ft-onoff-form');
    const sections = ['trackers', 'add-tracker'].map((id) => document.getElementById(id));
    const toggle = form.querySelector('.ft-onoff');
    const flip = () => { // the switch moves at once; the answer replaces it anyway
      if (!toggle) return;
      const on = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(on));
      toggle.closest('.ft-tracker').classList.toggle('ft-tracker-off', !on);
    };
    flip();
    for (const s of sections) s?.classList.add('ft-pending');
    try {
      const response = await fetch(form.action, {
        method: 'POST', body: new URLSearchParams(new FormData(form)), credentials: 'same-origin', headers: { Accept: 'text/html' },
      });
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!doc.getElementById('trackers')) { // not the editor any more (the login, no permission): go there
        window.location.assign(response.url);
        return;
      }
      for (const id of PARTS) {
        const fresh = doc.getElementById(id);
        const old = document.getElementById(id);
        if (fresh && old) old.replaceWith(document.importNode(fresh, true));
      }
      const bad = main.querySelector('#trackers .ft-rename-form:not([hidden]) input, #add-tracker .is-invalid');
      const row = rowId ? document.getElementById(rowId) : null;
      if (bad) bad.focus();
      else if (form.id === 'ft-add-tracker') document.getElementById('f-trackerName')?.focus();
      else row?.querySelector(isSwitch ? '.ft-onoff' : 'a[data-rename]')?.focus();
    } catch {
      flip(); // nothing is known to have happened: put the switch back and say so
      for (const s of sections) s?.classList.remove('ft-pending');
      say('Could not reach the server. Check the connection and try again.');
    } finally {
      sending = false;
    }
  }

  main.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.closest('#trackers, #add-tracker')) return;
    event.preventDefault();
    event.stopPropagation(); // app.js would show its own spinner and wait for a page that never loads
    send(form);
  });
})();
