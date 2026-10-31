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

// Delete links open a Bootstrap modal instead of the confirmation page (which stays as the way without JavaScript). The link's
// data-confirm-* attributes say what to ask and where to post (views/confirmDelete.tsx); the dialog is the page's `#ft-confirm`.
// The form is then posted normally; the group editor sends a tracker's (`data-confirm-swap`) in place, see group-editor.js.
(() => {
  const dialog = document.getElementById('ft-confirm');
  const form = document.getElementById('ft-confirm-form');
  if (!dialog || !form || !window.bootstrap)
    return;

  // Capture phase: the page-wide click handler in app.js must not start a navigation for the link.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element
      ? event.target.closest('a[data-confirm-action]')
      : null;
    if (!link ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey)
      return;

    event.preventDefault();
    event.stopPropagation();
    form.action = link.dataset.confirmAction;
    form.dataset.swap = link.hasAttribute('data-confirm-swap') ? '1' : '';
    document.getElementById('ft-confirm-title').textContent = link.dataset.confirmTitle;
    document.getElementById('ft-confirm-text').textContent = link.dataset.confirmText;
    document.getElementById('ft-confirm-button').textContent = link.dataset.confirmButton;
    window.bootstrap.Modal.getOrCreateInstance(dialog).show();
  }, true);

  dialog.addEventListener(
    'shown.bs.modal',
    () => dialog.querySelector('.modal-footer .btn-outline-secondary').focus(),
  ); // the safe choice
})();
