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

// Submit buttons wait until there is something worth sending. For every POST form that has fields:
//  - the browser's own checks pass (required, pattern, type="email", maxlength) and, where the page has more rules
//    (live-hints.js sets `form.ftValid`, no tip is showing, a typed confirmation `data-equals` matches), those pass too;
//  - a form marked data-guard="changed" (an edit form that starts with the saved values) also needs a value that differs
//    from what the page was rendered with; it stays open for a retry when it came back with an error (.is-invalid).
// Forms without fields (Log out, Delete, a one-click confirmation) are left alone, and so is data-guard="off": the two login
// forms (menu bar and /login) use it, because a password manager may fill them without the page seeing the values.
// Without this script nothing is disabled, so every form still works; the server checks everything again anyway.
// Other scripts call window.ftGuard() after they change a field or swap a part of the page.
(() => {
  const FIELDS =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea';

  // A password manager may fill a field without the page being told its value yet: that counts as typed. (The login forms
  // do not rely on this: they opt out of the guard altogether.)
  function autofilled(field) {
    for (const selector of [':autofill', ':-webkit-autofill'])
      try {
        if (field.matches(selector))
          return true;
      } catch { /* this browser does not know it */ }

    return false;
  }

  function fieldsOf(form) {
    return [...form.elements].filter((e) => e.matches(FIELDS) && !e.disabled && !e.readOnly);
  }

  function ready(form, fields) {
    for (const f of fields) {
      if (f.dataset.equals !== undefined &&
        f.value.trim().toLowerCase() !== f.dataset.equals.toLowerCase())
        return false;

      if (!f.checkValidity() && !(f.validity.valueMissing && autofilled(f)))
        return false;
    }
    if (form.querySelector('.ft-hints li:not([hidden])'))
      return false;
    if (form.ftValid && !form.ftValid())
      return false;
    if (form.dataset.guard !== 'changed')
      return true;
    if (form.querySelector('.is-invalid'))
      return true;
    // A form whose fields come and go (the task editor) says itself whether it differs from what was saved.
    const probe = { changed: null };
    form.dispatchEvent(new CustomEvent('ft-changed', { bubbles: true, detail: probe }));
    if (probe.changed !== null)
      return probe.changed;
    return fields.some((f) => {
      if (f.tagName === 'SELECT')
        return [...f.options].some((o) => o.selected !== o.defaultSelected);
      return f.type === 'checkbox' || f.type === 'radio'
        ? f.checked !== f.defaultChecked
        : f.value !== f.defaultValue;
    });
  }

  function guard() {
    for (const form of document.querySelectorAll('form')) {
      if (form.method !== 'post' || form.dataset.guard === 'off')
        continue;
      const button = form.querySelector('button[type="submit"]');
      const fields = fieldsOf(form);
      if (!button || fields.length === 0)
        continue;
      button.disabled = !ready(form, fields);
    }
  }

  window.ftGuard = guard;
  document.addEventListener('input', guard);
  document.addEventListener('change', guard);
  window.addEventListener('pageshow', guard);
  guard();
  for (const ms of [150, 600, 1500])
    setTimeout(guard, ms); // browsers fill saved logins a moment after the page loads
})();
