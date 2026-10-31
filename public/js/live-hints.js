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

// Live tips on forms that set a username, email or password (register, change email, reset / change
// password).
//
// A tip appears under a field only when one of its rules is broken, and only once the person has
// left the field; from then on it follows what they type and disappears as soon as the rule is met.
// While any tip is showing, the submit button is disabled. Whether a username / email is still free
// is asked from the server (debounced, silently), and the answer shows as a tip the same way. The
// server checks everything again on submit.
//
// Form attributes: data-min-password, data-forbidden (comma-separated values the password must not
// equal, for pages that have no username / email field), data-current-email (the address a new one
// must differ from).
(() => {
  const form = document.querySelector('form[data-live-validate]');
  if (!form) return;

  const field = (name) => form.elements[name]; // undefined when this form has no such field
  const value = (name) => (field(name) ? field(name).value : '');
  const forbidden = (form.dataset.forbidden || '')
    .split(',')
    .filter(Boolean)
    .map((v) => v.toLowerCase());
  const currentEmail = (form.dataset.currentEmail || '').toLowerCase();
  // from the server, which owns the rule:
  const MIN_PASSWORD = Number(form.dataset.minPassword) || 6;
  const MAX_PASSWORD = 128;

  // field name -> rule name -> test (true = fine). "free" needs the server and is handled
  // separately below.
  const RULES = {
    username: {
      len: (v) => v.trim().length >= 3 && v.trim().length <= 64,
      chars: (v) => /^[A-Za-z0-9._-]+$/.test(v.trim()),
    },
    email: {
      format: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
      different: (v) => v.trim().toLowerCase() !== currentEmail,
    },
    password: {
      len: (v) => v.length >= MIN_PASSWORD && v.length <= MAX_PASSWORD,
      differs: (v) => {
        const lower = v.toLowerCase();
        return (
          lower !== value('username').trim().toLowerCase() &&
          lower !== value('email').trim().toLowerCase() &&
          !forbidden.includes(lower)
        );
      },
    },
    confirmPassword: {
      match: (v) => v === value('password'),
    },
  };

  const names = Object.keys(RULES).filter((name) => field(name)); // the fields this form has
  const touched = new Set(); // fields the person has left at least once
  const taken = { username: false, email: false }; // the server's answer for the current value
  const timers = {};
  const requests = {};

  function violated(name, item) {
    const rule = item.dataset.rule;
    const v = value(name);
    if (rule === 'free') return taken[name] && Object.values(RULES[name]).every((test) => test(v));
    // An empty field gets one tip (the first rule), not a pile of them.
    if (v === '' && item !== item.parentElement.firstElementChild && rule !== 'match') return false;
    return !RULES[name][rule]?.(v);
  }

  function render(name) {
    const list = form.querySelector(`[data-hints="${name}"]`);
    if (!list) return;
    for (const item of list.querySelectorAll('li')) {
      const bad = touched.has(name) && violated(name, item);
      item.hidden = !bad;
    }
    window.ftGuard?.();
  }

  // Is the value free? Only asked once the local rules pass, and not on every key press; the answer
  // stays silent until the field has been left.
  function checkFree(name) {
    clearTimeout(timers[name]);
    requests[name]?.abort();
    taken[name] = false;
    const v = value(name).trim();
    if (!Object.values(RULES[name]).every((test) => test(v))) return;
    timers[name] = setTimeout(() => {
      const controller = new AbortController();
      requests[name] = controller;
      fetch(`/register/check?${name}=${encodeURIComponent(v)}`, {
        signal: controller.signal,
        credentials: 'same-origin',
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => {
          taken[name] = Boolean(data.taken);
          render(name);
        })
        .catch(() => {
          /* no answer: nothing to show, the server checks on submit */
        });
    }, 400);
  }

  function update(name) {
    if (name === 'username' || name === 'email') checkFree(name);
    render(name);
    // fields whose tips depend on this one
    if (name === 'username' || name === 'email') render('password');
    if (name === 'password') render('confirmPassword');
  }

  for (const name of names) {
    field(name).addEventListener('input', () => update(name));
    field(name).addEventListener('blur', () => {
      touched.add(name);
      update(name);
    });
    // The browser or a failed submit may have filled it in: look the free-check up quietly so that
    // it is ready.
    if ((name === 'username' || name === 'email') && value(name) !== '') checkFree(name);
  }

  // guard.js asks: do all the local rules pass, and is the value not known to be taken?
  form.ftValid = () =>
    names.every(
      (name) => Object.values(RULES[name]).every((test) => test(value(name))) && !taken[name],
    );

  // Clicking Register on an untouched form is the other way to "leave" every field: show all
  // problems at once.
  form.addEventListener('submit', (event) => {
    for (const name of names) {
      touched.add(name);
      render(name);
    }
    const firstBad = names.find((name) =>
      form.querySelector(`[data-hints="${name}"] li:not([hidden])`),
    );
    if (firstBad) {
      event.preventDefault();
      field(firstBad).focus();
    }
  });
})();
