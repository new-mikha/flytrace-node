// Live hints on the register page: ticks the checklist under each field while the person types, and asks the server
// (debounced) whether the username / email is still free. The server checks everything again on submit.
(() => {
  const form = document.querySelector('form[data-live-validate]');
  if (!form) return;

  const field = (name) => form.elements[name];
  const value = (name) => field(name).value;
  const MIN_PASSWORD = Number(form.dataset.minPassword) || 6; // from the server, which owns the rule
  const MAX_PASSWORD = 128;

  // name of field -> rule name -> test. Rules that need the server ("free") are handled separately below.
  const RULES = {
    username: {
      len: (v) => v.trim().length >= 3 && v.trim().length <= 64,
      chars: (v) => /^[A-Za-z0-9._-]+$/.test(v.trim()),
    },
    email: {
      format: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
    },
    password: {
      len: (v) => v.length >= MIN_PASSWORD && v.length <= MAX_PASSWORD,
      differs: (v) => {
        const lower = v.toLowerCase();
        return lower !== value('username').trim().toLowerCase() && lower !== value('email').trim().toLowerCase();
      },
    },
    confirmPassword: {
      match: (v) => v === value('password'),
    },
  };

  const ICONS = {
    idle: 'fa-regular fa-circle fa-fw text-muted',
    ok: 'fa-solid fa-circle-check fa-fw text-success',
    bad: 'fa-solid fa-circle-xmark fa-fw text-danger',
    wait: 'fa-solid fa-spinner fa-spin fa-fw text-muted',
  };

  const touched = new Set(); // fields the person has left once: from then on a failing rule is shown as a problem
  const free = { username: 'idle', email: 'idle' }; // 'idle' | 'wait' | 'ok' | 'bad' from the server check
  const timers = {};
  const requests = {};

  function setState(item, state, text) {
    item.dataset.state = state;
    item.querySelector('i').className = ICONS[state];
    item.querySelector('.ft-hint-text').textContent = text ?? item.dataset.text;
  }

  function render(name) {
    const list = form.querySelector(`[data-hints="${name}"]`);
    if (!list) return;
    const v = value(name);
    const started = v !== '' || touched.has(name);
    const localOk = {};
    for (const item of list.querySelectorAll('li')) {
      const rule = item.dataset.rule;
      if (rule === 'free') continue;
      const test = RULES[name]?.[rule];
      const passes = test ? test(v) : false;
      localOk[rule] = passes;
      // neutral until the person starts typing (or has left the field), then ticked or marked as a problem
      setState(item, !started ? 'idle' : v !== '' && passes ? 'ok' : 'bad');
    }
    const freeItem = list.querySelector('[data-rule="free"]');
    if (freeItem) {
      const state = free[name];
      const valid = Object.values(localOk).every(Boolean);
      if (!valid || v === '') setState(freeItem, 'idle');
      else if (state === 'bad') setState(freeItem, 'bad', freeItem.dataset.bad);
      else setState(freeItem, state === 'ok' ? 'ok' : state === 'wait' ? 'wait' : 'idle');
    }
  }

  // Is the value free? Only asked once the local rules pass, and not on every key press.
  function checkFree(name) {
    clearTimeout(timers[name]);
    requests[name]?.abort();
    const v = value(name).trim();
    const valid = Object.values(RULES[name]).every((test) => test(v));
    if (!valid) { free[name] = 'idle'; render(name); return; }
    free[name] = 'wait';
    render(name);
    timers[name] = setTimeout(() => {
      const controller = new AbortController();
      requests[name] = controller;
      fetch(`/register/check?${name}=${encodeURIComponent(v)}`, { signal: controller.signal, credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => { free[name] = data.taken ? 'bad' : 'ok'; render(name); })
        .catch((err) => { if (err.name !== 'AbortError') { free[name] = 'idle'; render(name); } });
    }, 400);
  }

  function update(name) {
    render(name);
    if (name === 'username' || name === 'email') checkFree(name);
    // fields whose hints depend on this one
    if (name === 'username' || name === 'email') render('password');
    if (name === 'password') render('confirmPassword');
  }

  for (const name of Object.keys(RULES)) {
    field(name).addEventListener('input', () => update(name));
    field(name).addEventListener('blur', () => { touched.add(name); render(name); });
    if (value(name) !== '') update(name); // the browser or a failed submit may have filled it in
  }

  // Do not post what is clearly wrong: show the problems and put the cursor in the first field with one.
  form.addEventListener('submit', (event) => {
    let firstBad = null;
    for (const name of Object.keys(RULES)) {
      touched.add(name);
      render(name);
      const v = value(name);
      const failing = Object.values(RULES[name]).some((test) => !test(v)) || free[name] === 'bad';
      if (failing && !firstBad) firstBad = field(name);
    }
    if (firstBad) {
      event.preventDefault();
      firstBad.focus();
    }
  });
})();
