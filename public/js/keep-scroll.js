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

// A form that is posted comes back as a fresh page (post, redirect, load), which starts at the top. This puts the page back
// where it was when the person pressed Save: the position is kept in sessionStorage for a few seconds and used by the next
// load of the same address, unless that address names a section (#...). The "Saved." message is at the top of the page, so when
// it is out of sight after the page was put back, it is shown once more as a toast.
// Forms that are sent in place (group-editor.js) never reach this: they stop the submit event.
(() => {
  const KEY = 'ft-scroll';
  const MAX_AGE_MS = 10000;
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const write = (value) => { try { if (value) sessionStorage.setItem(KEY, JSON.stringify(value)); else sessionStorage.removeItem(KEY); } catch { /* storage blocked: the page just starts at the top */ } };

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement) || form.method !== 'post') return;
    write({ path: location.pathname, y: window.scrollY, at: Date.now() });
  });

  const saved = read();
  write(null); // used once
  if (!saved || saved.path !== location.pathname || Date.now() - saved.at > MAX_AGE_MS || location.hash) return;
  window.scrollTo({ top: saved.y, behavior: 'instant' });

  const alert = document.querySelector('#ft-flash .alert, main > .alert');
  if (!alert) return;
  requestAnimationFrame(() => {
    const box = alert.getBoundingClientRect();
    if (box.bottom > 0 && box.top < window.innerHeight) return; // in sight: nothing to add
    const toast = alert.cloneNode(true);
    toast.classList.add('ft-toast', 'shadow');
    toast.removeAttribute('id');
    document.body.append(toast);
    const close = () => toast.remove();
    toast.addEventListener('click', close);
    setTimeout(close, 4000);
  });
})();
