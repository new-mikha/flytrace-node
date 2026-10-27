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

// Group editor: while the person types the tracker link, the SPOT / inReach choice follows it (until they pick one themselves).
(() => {
  const form = document.getElementById('ft-add-tracker');
  const link = form?.querySelector('input[name="link"]');
  const radios = form ? [...form.querySelectorAll('input[name="type"]')] : [];
  if (!link || radios.length === 0) return;
  let chosenByHand = radios.some((r) => r.checked);

  const SPOT = /^\s*(?:(?:https?:\/\/)?share\.findmespot\.com\/shared\/faces\/viewspots\.jsp\?glId=)?[^\s\\/?=&#]{20,50}\s*$/i;
  const guess = (text) => (/garmin\.com|#/i.test(text) ? 'G' : SPOT.test(text) ? 'S' : /\S/.test(text) ? 'G' : null);

  for (const r of radios) r.addEventListener('change', () => { chosenByHand = true; });
  link.addEventListener('input', () => {
    if (chosenByHand) return;
    const type = guess(link.value);
    for (const r of radios) r.checked = r.value === type;
  });
})();

// Rename and Cancel on a tracker row swap the name and the rename form in place: no request, no page flicker, no scroll.
// (Without this script they are links that reload the page with the form shown.) Escape cancels.
(() => {
  const list = document.querySelector('.ft-trackers');
  if (!list) return;

  function show(row, renaming) {
    const form = row.querySelector('.ft-rename-form');
    if (!form) return;
    const input = form.querySelector('input[name="name"]');
    row.querySelector('.ft-tracker-name').hidden = renaming;
    row.querySelector('.ft-actions').hidden = renaming;
    form.hidden = !renaming;
    if (renaming) {
      input.focus();
      input.select();
    } else {
      input.value = form.dataset.name; // what the cancelled edit left behind is dropped
      input.classList.remove('is-invalid');
      form.querySelector('.invalid-feedback')?.remove();
    }
  }

  list.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-rename], a[data-rename-cancel]') : null;
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation(); // the page-wide handler in app.js must not start a navigation for it
    for (const open of list.querySelectorAll('.ft-rename-form:not([hidden])')) show(open.closest('.ft-tracker'), false);
    if (link.hasAttribute('data-rename')) show(link.closest('.ft-tracker'), true);
  });

  list.addEventListener('keydown', (event) => {
    const form = event.target instanceof Element ? event.target.closest('.ft-rename-form') : null;
    if (event.key === 'Escape' && form) show(form.closest('.ft-tracker'), false);
  });
})();
