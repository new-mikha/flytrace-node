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

// Forms that are sent in place, the way an UpdatePanel did in the old site. A form with
// data-swap="id id ..." is posted with fetch; the answer is the whole page (the server redirects
// and renders as always, so everything works without this script), and the listed parts of the page
// are replaced by those of the answer: no page load, no scroll jump, no flicker. Refused changes
// come back as a page with their errors, which is swapped in the same way. The server stays the
// only place with rules.
//  - window.ftSwap.send(form, ids) does the sending for scripts that have their own forms
//    (group-editor.js); it says whether the parts were swapped;
//  - the message above the page is shown as a toast too when it is out of sight (keep-scroll.js,
//    window.ftToast);
//  - when the answer is not the same page (the login, no permission), the browser goes there
//    instead.
(() => {
  const main = document.querySelector('main');
  if (!main) return;
  let busy = false;

  function say(text) {
    const box = document.getElementById('ft-flash');
    if (!box) return;
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.setAttribute('role', 'alert');
    alert.textContent = text;
    box.replaceChildren(alert);
    window.ftToast?.(alert);
  }

  async function send(form, ids) {
    if (busy) return false; // one change at a time, in the order the person made them
    busy = true;
    const waiting = ids
      .filter((id) => id !== 'ft-head' && id !== 'ft-flash')
      .map((id) => document.getElementById(id));
    for (const part of waiting) part?.classList.add('ft-pending');
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!ids.every((id) => doc.getElementById(id))) {
        // not this page any more (the login, no permission): go there
        window.location.assign(response.url);
        return false;
      }
      for (const id of ids)
        document.getElementById(id)?.replaceWith(document.importNode(doc.getElementById(id), true));
      document.title = doc.title;
      // the new forms start with what was just saved: their buttons wait for the next change
      window.ftGuard?.();
      // the last change's message is not this one's
      for (const old of document.querySelectorAll('.ft-toast')) old.remove();
      const alert = document.querySelector('#ft-flash .alert');
      if (alert) window.ftToast?.(alert);
      return true;
    } catch {
      for (const part of waiting) part?.classList.remove('ft-pending');
      say('Could not reach the server. Check the connection and try again.');
      return false;
    } finally {
      busy = false;
    }
  }

  window.ftSwap = { send };

  main.addEventListener('submit', (event) => {
    const form = event.target;
    const ids =
      form instanceof HTMLFormElement ? (form.dataset.swap || '').split(/\s+/).filter(Boolean) : [];
    // the dialog's own form decides in group-editor.js
    if (ids.length === 0 || form.id === 'ft-confirm-form') return;
    event.preventDefault();
    // app.js would show its own spinner and wait for a page that never loads; keep-scroll.js has
    // nothing to keep
    event.stopPropagation();
    const action = form.getAttribute('action');
    send(form, ids).then((swapped) => {
      if (!swapped) return;
      // A refused change: put the cursor in the field that has the message.
      document.querySelector(`form[action="${action}"] .is-invalid`)?.focus();
    });
  });
})();
