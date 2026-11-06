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

// Forms with data-captcha: reCAPTCHA v3 asks Google for a token when the form is sent, and the
// server checks it (auth/captcha.ts). Google's script is loaded only once the person starts on the
// form. If it cannot be had (a blocker, no network), the form goes without a token and the server
// answers with a way out.
(() => {
  const form = document.querySelector('form[data-captcha]');
  if (!form) return;
  const { captcha: action, captchaKey: key } = form.dataset;
  let loading;
  let done = false;

  function load() {
    loading ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}`;
      script.onload = () => window.grecaptcha.ready(resolve);
      script.onerror = reject;
      document.head.append(script);
    });
    return loading;
  }

  form.addEventListener('focusin', () => load().catch(() => {}), { once: true });

  form.addEventListener('submit', async (event) => {
    if (done) return; // the second time round: on to app.js and the server
    event.preventDefault();
    event.stopPropagation();
    try {
      await load();
      form.elements.captcha.value = await window.grecaptcha.execute(key, { action });
    } catch {
      form.elements.captcha.value = '';
    }
    done = true;
    // Not straight away: the browser ignores a submit while it is still in the event of this one,
    // which is where a token that came at once would leave us.
    setTimeout(() => form.requestSubmit(event.submitter));
  });
})();
