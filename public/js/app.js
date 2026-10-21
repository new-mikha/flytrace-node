// Small progressive enhancements. Every page still works without this script.
//
// One "current action" at a time: a link navigation, an in-place swap ("Show all") or a form post. Starting a new
// action cancels the pending one and restores its button; the exception is a form post, which is never cancelled
// (the server may already have handled it), so other clicks are ignored while one is in flight.
// A thin bar at the top of the page (#ff-progress) shows that something is loading.
(() => {
  const bar = document.getElementById('ff-progress');
  let current = null; // { kind: 'nav' | 'swap' | 'post', restore(), cancel() }

  // ---- progress bar ----
  function barStart() {
    if (!bar) return;
    bar.classList.remove('active', 'done');
    void bar.offsetWidth; // restart the CSS animation
    bar.classList.add('active');
  }
  function barDone() {
    if (!bar) return;
    bar.classList.add('done');
    setTimeout(() => { if (!current) bar.classList.remove('active', 'done'); }, 350);
  }
  function barReset() { bar?.classList.remove('active', 'done'); }

  // ---- busy state of the pressed control: disabled, with a spinner ----
  function showBusy(el) {
    const label = el.querySelector('.ff-label');
    const busy = el.querySelector('.ff-busy');
    const isButton = el instanceof HTMLButtonElement;
    el.classList.add('disabled');
    el.setAttribute('aria-busy', 'true');
    if (isButton) el.disabled = true;

    let gap = null;
    let spinner = null;
    if (label && busy) { // markup that brings its own busy label (the Log in button)
      label.classList.add('d-none');
      busy.classList.remove('d-none');
    } else {
      gap = document.createTextNode(' ');
      spinner = document.createElement('i');
      spinner.className = 'fa-solid fa-spinner fa-spin ff-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      el.append(gap, spinner);
    }
    return () => {
      el.classList.remove('disabled');
      el.removeAttribute('aria-busy');
      if (isButton) el.disabled = false;
      if (label && busy) { label.classList.remove('d-none'); busy.classList.add('d-none'); }
      gap?.remove();
      spinner?.remove();
    };
  }

  // ---- actions ----
  function begin(kind, el, cancel) {
    if (current) abort(current);
    const action = { kind, restore: showBusy(el), cancel };
    current = action;
    barStart();
    return action;
  }
  function finish(action) {
    if (current !== action) return;
    action.restore();
    current = null;
    barDone();
  }
  function abort(action) {
    action.cancel?.();
    action.restore();
    if (current === action) current = null;
    barReset();
  }

  // Does clicking this link load another page in this tab?
  function navigates(link) {
    const href = link.getAttribute('href') ?? '';
    return !(link.target === '_blank' || link.hasAttribute('download') || link.hasAttribute('data-bs-toggle')
      || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href));
  }

  function startNavigation(link) {
    // The browser drops an earlier pending navigation by itself; we only tidy up its button. If the page never
    // arrives (e.g. the user presses the browser's stop button) there is no event, so give up on the spinner after a while.
    const timer = setTimeout(() => { if (current === action) abort(action); }, 30_000);
    const action = begin('nav', link, () => clearTimeout(timer));
  }

  // Links with data-swap-target="<id>": fetch the same address with fragment=1 and swap the result into that element,
  // leaving the address bar alone (a refresh shows the page's default state). Without this script, or when the
  // request fails, the link simply opens normally.
  function swap(link, target) {
    if (current?.kind === 'nav') window.stop(); // cancel the page load that is still pending
    const controller = new AbortController();
    const action = begin('swap', link, () => controller.abort());
    const url = new URL(link.href);
    url.searchParams.set('fragment', '1');
    fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => {
        if (controller.signal.aborted) return;
        target.innerHTML = html;
        if (link.hasAttribute('data-swap-scroll')) target.scrollIntoView({ block: 'start' });
        finish(action);
      })
      .catch(() => {
        if (controller.signal.aborted) return; // cancelled by a newer action
        abort(action);
        window.location.href = link.href;
      });
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || !navigates(link)) return;
    if (current?.kind === 'post') { event.preventDefault(); return; } // never cancel a form post

    const target = link.dataset.swapTarget ? document.getElementById(link.dataset.swapTarget) : null;
    if (target) {
      event.preventDefault();
      swap(link, target);
    } else {
      startNavigation(link);
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement) || form.method !== 'post') return;
    if (current?.kind === 'post') { event.preventDefault(); return; } // already being sent
    const button = event.submitter ?? form.querySelector('button[type="submit"], button:not([type])');
    if (button) begin('post', button, null);
  });

  // Coming back with the Back button can restore the page from the browser cache with buttons still busy.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    if (current) abort(current);
    barReset();
  });
})();
