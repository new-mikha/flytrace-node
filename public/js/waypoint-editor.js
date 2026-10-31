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

// Waypoints manager enhancements. Every control also works without this script (links and forms);
// with it:
//  - Edit opens the row's form in place (the page is fetched with ?edit= and the table swapped),
//    Cancel closes it again;
//  - Delete asks in the dialog of confirm-dialog.js and is sent in place (swap.js);
//  - the server stays the only place with rules: it answers with the whole page.
(() => {
  const main = document.querySelector('main');
  if (!main) return;
  const PARTS = ['ft-flash', 'load', 'waypoints', 'add-waypoint'];
  const closest = (event, selector) =>
    event.target instanceof Element ? event.target.closest(selector) : null;
  const plainClick = (event) =>
    event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

  // ---- Edit / Cancel: swap the table for the one the server renders with (or without) the form
  async function openRow(link) {
    const section = document.getElementById('waypoints');
    section?.classList.add('ft-pending');
    try {
      const response = await fetch(link.href, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const fresh = doc.getElementById('waypoints');
      if (!fresh) {
        window.location.assign(link.href);
        return;
      }
      section.replaceWith(document.importNode(fresh, true));
      window.ftGuard?.();
      document.querySelector('#waypoints .ft-wpt-edit input[name="name"]')?.focus();
    } catch {
      window.location.assign(link.href);
    }
  }

  main.addEventListener('click', (event) => {
    const link = closest(event, 'a[data-wpt-edit], a[data-wpt-cancel]');
    if (!link || !plainClick(event)) return;
    event.preventDefault();
    event.stopPropagation(); // the page-wide handler in app.js must not start a navigation for it
    openRow(link);
  });

  main.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closest(event, '.ft-wpt-edit')?.querySelector('a[data-wpt-cancel]')?.click();
  });

  // ---- the row just added or updated (the server marks it) is brought into view after a swap, but
  // only when that add or update caused the swap: a refused delete must not scroll back to it
  let saved = false;
  main.addEventListener(
    'submit',
    (event) => {
      saved =
        event.target instanceof Element && !!event.target.closest('#add-waypoint, .ft-wpt-edit');
    },
    true,
  );
  // The server marks the row once (class ft-wpt-new, in the page that follows an add or update). The
  // mark stays while the page is open: later swaps (a refused delete, a format change) bring a table
  // without it, so the row is marked again, without the flash (ft-wpt-keep), until the next add or
  // update. A page reload forgets it.
  const holder = document.querySelector('.ft-waypoints-page');
  let marked = holder?.querySelector('.ft-wpt-new')?.id ?? null;
  if (holder)
    new MutationObserver(() => {
      const wasSaved = saved;
      saved = false;
      const fresh = holder.querySelector('.ft-wpt-new');
      if (fresh) {
        marked = fresh.id;
        // a refused change has no success message, and the old mark is not worth a trip
        if (!wasSaved || !document.querySelector('#ft-flash .alert-success')) return;
        const box = fresh.getBoundingClientRect();
        if (box.top < 0 || box.bottom > window.innerHeight)
          fresh.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (marked) {
        const row = document.getElementById(marked);
        if (row && row.tagName === 'TR' && !row.classList.contains('ft-wpt-edit'))
          row.classList.add('ft-wpt-keep');
      }
    }).observe(holder, { childList: true });

  // ---- Delete: the dialog's form is sent in place
  const dialog = document.getElementById('ft-confirm');
  const dialogForm = document.getElementById('ft-confirm-form');
  if (dialog && dialogForm && window.bootstrap)
    dialogForm.addEventListener('submit', (event) => {
      if (dialogForm.dataset.swap !== '1') return;
      event.preventDefault();
      event.stopPropagation();
      window.bootstrap.Modal.getInstance(dialog)?.hide();
      window.ftSwap.send(dialogForm, PARTS);
    });
})();
