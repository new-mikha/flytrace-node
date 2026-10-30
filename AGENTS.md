# Flytrace (Node + Postgres rewrite): agent instructions

Rewrite of the legacy ASP.NET site https://www.flytrace.com/tracker. Read `README.md` for setup and
`docs/legacy-system.md` (how the old system works) before porting any feature.

Paths in this file are relative to the directory containing it (`flytrace-node/`), even when it is loaded
from a parent workspace folder.

## Rules

- Go slow: do not add map, tracker polling or group management unless asked, and do not add features nobody
  asked for (the owner prefers less: e.g. no "Remember me").
- "Revert" means undo only the most recent change; if it could mean more than that, ask which.
- The owner usually has `npm run dev` (watch mode) running on port 3000. Never stop it: start your own test server
  on another port (`PORT=3100 npm run dev`) and kill only the process you started, never by port or process name.
- License: AGPL-3.0-or-later (`LICENSE`, `package.json`). Every new source file (`.ts`, `.tsx`, `.js`, `.css`, `.sql`, `.sh`) starts with the
  license header: copy it from any existing file (`//` comments; `#` in shell scripts, `--` in SQL, `/* */` in CSS; after a `#!` line in scripts), and keep the
  years `2011-<current year>`. `server/test/license-headers.test.ts` fails when a file lacks it.
- Keep numeric group, event and tracker IDs unchanged (nginx will later redirect the old `.aspx` URLs).
- `db/legacy/dump/` holds production personal data (emails, password hashes) and is gitignored. Never print
  its contents or copy it elsewhere.
- **Do not read secrets.** Never open `.env` or other `.env.*` files (only `.env.example` is fine), and do not
  read the dump files directly (no `cat`, `grep`, `head`, scripts that print rows). Running the import script
  on the dump is fine. If you need to know whether a variable is set, ask the owner. These paths are denied in
  `.claude/settings.json` and listed in the ignore files in this directory (`.cursorignore`, `.aiderignore`,
  `.codeiumignore`, `.geminiignore`, `.clineignore`, `.rooignore`, `.continueignore`, `.aiexclude`,
  `.augmentignore`), plus `opencode.json` for opencode. Keep them in sync when adding new secret locations.
  Write every path pattern so it does not assume the repo root (`**/db/legacy/dump/`, not `db/legacy/dump/`):
  during the upgrade these files are also copied into the parent workspace folder (`flytrace-upgrade/`, by
  its `sync-workspace.sh`), and the files in this directory are the masters.

## Stack and commands

TypeScript (ESM, strict), Fastify 5, plain `pg` SQL (no ORM), vitest, Postgres 16 in Docker (port 5433).

- `docker compose up -d`: start Postgres. `.env` is copied from `.env.example`.
- `npm run db:reset`: dev only, drops and recreates the DB (refuses unless the name contains `_dev`), then migrates.
- `npm run db:import-legacy -- db/legacy/dump/<timestamp>`: staging, transform and verify in one transaction.
- `npm run user:create -- <name> <password> [role]`: dev user. `npm run dev`, `npm test`, `npm run typecheck`.
- `npm run build` compiles into `dist/` and copies the migrations and the import SQL next to it. `scripts/deploy.sh user@host` builds and
  copies `dist/`, `public/`, `package.json` and `package-lock.json` to the server (home Raspberry Pi); the server keeps its `.env`,
  `node_modules` and database. There, `node dist/db/migrate.js` applies migrations and `node dist/server/src/index.js` starts the app.
  The app runs there as the systemd service `flytrace` (`deploy/flytrace.service`, installed once by `scripts/setup-service.sh user@host`,
  which also allows passwordless `sudo systemctl restart flytrace` only). `scripts/deploy.sh` runs `npm ci --omit=dev` on the server when
  `package-lock.json` changed, restarts the service and fails unless the home page answers 200 within 30 seconds.

UI: pages are server-rendered with Preact JSX (`server/src/views/*.tsx`, `preact-render-to-string`; Preact escapes
text and attributes by default, so avoid `dangerouslySetInnerHTML` for user data), styled with Bootstrap 5 CSS and
Font Awesome Free, both served straight from `node_modules` under `/vendor/`. Our own CSS, JS and images live in
`public/` (served under `/assets/`). Small enhancements go in `public/js/app.js`; heavier interactive parts
(map, waypoint editor) will be separate client-side "islands" later.

The schema is not deployed yet, so `db/migrations/0001_schema.sql` is edited in place (the owner wants a single
migration during the dev phase: do not add `0002_...`); once deployed, add new numbered migrations instead. After
editing it, tell the owner how to rebuild the dev DB: `npm run db:reset`, then `npm run db:import-legacy -- ...`
(the imported dump already contains an admin, so `user:create` is not needed). Do not reset it yourself.

Tests run against the dev database and share one rate limiter per client IP, so tests that log in or post give each
simulated client its own `remoteAddress`.

## UI conventions

- Our CSS classes and ids use the `ft-` prefix (Flytrace). Never use `ff-` (that was flockfix) and do not mention
  flockfix in code or comments.
- Pages are "cards": `Layout` with `card` (small, for sign-in pages), `card="medium"` (My account) or `card="wide"` (home): a shadowed
  card on the faded map background with a gap under the menu. Below 768 px the card merges into the plain full-width
  panel. Pages using the older `legacyPage` template are still plain panels.
- The menu bar is a mid blue on the day theme and dark navy on the night theme, white text on both (rule at the end of `flytrace.css`). It is sticky; an open burger menu closes when the page is scrolled (`app.js`). Logged-out visitors get a text toggle "Log in, Register, etc" on small screens, logged-in
  users the burger icon. Signed in, the bar has Home (and Admin for admins) after the brand; its right end (and the phone menu, same order)
  is: day/night switch, Settings, then the user name as plain text with Log out on the same line (a long name wraps).
- `public/js/app.js` shows a spinner and disables only `.btn` elements (never plain links), plus the loading bar at
  the top; a new click cancels the pending navigation, a form POST is never cancelled.
- Day / night theme: the `ft-theme` cookie (`dark`, anything else means day; day is the default whatever the browser
  prefers). The server puts Bootstrap's `data-bs-theme` on `<html>` (an `onSend` hook in `app.ts`), `app.js` switches it
  in place, `/theme` does it without JavaScript. Our own colours get a `[data-bs-theme="dark"]` variant in `flytrace.css`:
  do the same for any new hard-coded colour.
- Signed-in home page: "Show others' public groups" (admins: "Show others' groups", which also lists unlisted groups, marked) is a plain link
  to `/?others=1#others`; the list (`listOthersGroups`: not mine, two or more trackers, same recent-week window as the public maps, `&all=1` for
  everything) appears under a "Hide ..." button. Admins get one more column there (a "Definition" link to `/groups/:id`); the group name always links to the map. Anonymous visitors keep the public maps with the in-place swap.
- Unchecked radios and checkboxes get a visible border (`.form-check-input:not(:checked)` in `flytrace.css`, from Bootstrap's `--bs-secondary-color`, so it follows the theme): Bootstrap's own is too pale.
- Scroll shadow (in `Layout`, on every page, `public/js/shadow.js`, `.ft-shadow*` and the `--ft-shadow-*` settings at the top of `flytrace.css`): there are no scroll bars to look at, so a soft strip under the lowest stuck bar (menu bar, section title, search row, table header) shows "more above", and one at the bottom of the screen "more below". The strips hang from sticky zero-height anchors in the page, not from the screen (`position: fixed`), so they move with the bars when a Mac trackpad pulls the page past its end. Each is clear at its end of the page and reaches full strength after `--ft-shadow-ramp` of scrolling; dense at the bar, clear at its other edge. Below 768 px the strips are taller (1.5rem) and denser (0.7). A new kind of sticky bar must be added to the script's `STICKY` list.
- Submit buttons wait (`public/js/guard.js`, loaded by `Layout` on every page; `window.ftGuard()` re-checks after a script changes a field): a POST form with fields keeps its button disabled until the browser's own checks pass
  (`required`, `pattern`, `type`, `maxlength`), no live tip is showing (`live-hints.js` also sets `form.ftValid`) and a typed confirmation `data-equals` matches. An edit form that starts with saved values (settings, group
  settings, rename, on/off) carries `data-guard="changed"` and also needs a value that differs from the rendered one (it stays open for a retry when it came back with errors); `data-guard="off"` opts out (the two login forms do: a password manager may fill them without the page seeing the values, so Log in is always enabled). Forms without fields
  (Log out, Delete, one-click confirmations) are left alone. Buttons carry no tick icon (it reads as "done"). New forms get this for free: make fields `required`/`pattern` as the server needs, and mark edit forms `changed`.
- Forms sent in place, like an UpdatePanel (`public/js/swap.js`): a form with `data-swap="id id ..."` is posted with `fetch` and only the listed parts of the page are replaced by those of the answer (the server still redirects and renders the whole page, so it all works without JavaScript; refused changes come back as a page with errors, a 422, and are swapped the same way; an answer that lacks a listed part, e.g. the login, is navigated to). Keep those ids. Used by the group editor: settings (`ft-head ft-flash settings`), task / event (`ft-flash task`) and, through `window.ftSwap.send`, the tracker forms (`group-editor.js`). The new forms get their Save button disabled again (`ftGuard`). Not for forms that leave the page (delete or create a group).
- Keep the scroll position (`public/js/keep-scroll.js`, loaded by the group editor so far; the plan is every page once it has proved itself): a posted form comes back as a fresh page, so the script stores `scrollY` in `sessionStorage` on submit and puts the next load of the same address back there (not when the address has a `#hash`; forms sent in place never reach it). The message at the top is shown again as a toast (`.ft-toast`) when it is out of sight.
- Page changes cross-fade through CSS view transitions (`@view-transition`, duration in `flytrace.css`).
- Check layout changes at phone (about 380 px), tablet and desktop widths, and clean up any temporary test page.

## Logging

- Every action that changes something or matters for security must call `audit(request, 'area.action', 'Readable
  message', { ...details })` from `server/src/audit.ts` (login, email, password, 2FA, account, and in future groups,
  events, trackers, waypoints: create, rename, delete, ...). Do it in new code too, even when nobody asks.
  Emails sent are logged by `MailService`. Page request lines (`GET /path 200 12ms [user]`) are logged
  automatically and skip `/assets/` and `/vendor/`.
- Never log secrets: passwords, codes, recovery codes, tokens, session ids, query strings, typed login names
  (people paste passwords there). Mask emails with `maskEmail`. Production logs are JSON; development uses pino-pretty.
- Log times are in the host's time zone, or in `LOG_TIMEZONE` (.env, e.g. `Europe/Berlin`), which sets `TZ` at startup
  (`index.ts`). Production lines carry ISO times with the offset. Times on pages (`views/format.ts`, `formatTimestamp`) use the same zone, show its name (`UTC`, `GMT+11`) and add the year when it is not the current one.
- When you start a test server, set `SMTP_HOST=` on its command line so that it does not send real email through
  the owner's SMTP account (it reads the owner's `.env`).

## Decisions (do not re-propose)

- The authenticator (TOTP) secret stays stored unencrypted in `users.two_factor_secret`.
- No JSON login API, no "Remember me", no stored procedures or triggers.
- Legacy rows whose names are the literal text `${output}` (broken client tool, many users) are kept as they are.
  The import renames duplicate names (`X (2)`, ...) and prints each rename.

## Planned (not started)

- A production build step (`npm run build`, probably Vite or esbuild), to be done late, once the pages have settled:
  one minified CSS file and one JS file instead of the separate Bootstrap, Font Awesome and our own files; a Font
  Awesome subset with only the icons we use; versioned file names (`app.<hash>.css`) read from a manifest by `Layout`
  in production only, so that `/assets/` can be cached for a year. Dev keeps serving the separate files from
  `node_modules`. Compression (gzip or brotli) and the cache headers go in nginx or `@fastify/static`. Do not start
  this unless asked.

## Auth model

- Server-side sessions (not JWT): cookie `flytrace.sid` = signed session id; data in the Postgres `sessions` table. The cookie
  is Secure in production (`COOKIE_SECURE` in .env overrides): `@fastify/session` sends no cookie at all for a Secure cookie
  over plain HTTP, so a production login only works behind HTTPS (the proxy must send `X-Forwarded-Proto`) or with `COOKIE_SECURE=false`.
- Login accepts username or email (both unique, case-insensitive). Legacy hashes `flytrace1|...` are verified
  and upgraded to argon2id on first login. Roles come from `user_roles`, loaded from the DB on every request.
- Registration rejects a username equal to another user's email (usernames cannot contain `@`, and a new email
  must not equal any username). Emailed links (confirm email, reset password, change email) are one-time tokens
  stored hashed in `user_tokens`; the link only shows a button, the token is spent by the POST.
- `REQUIRE_CONFIRMED_EMAIL` (.env) makes confirmation mandatory for login. SMTP is configured by `SMTP_*` in .env;
  without `SMTP_HOST` emails are written to the server log instead. Placeholders live in `.env.example`.
- Optional two-factor login with an authenticator app (TOTP, `otpauth`) plus single-use recovery codes. The login
  has a second step (`/login/2fa`, `/login/recovery`). There is no JSON login API; pages use the session cookie.
- Code: `server/src/auth/` (`password.ts`, `service.ts`, `accounts.ts`, `tokens.ts`, `totp.ts`, `session.ts`,
  `guards.ts`), `server/src/mail/`, pages in `server/src/routes/identity.tsx` (signed out) and
  `account.tsx` (My account), views in `server/src/views/IdentityPages.tsx` and `AccountPages.tsx`.
- Settings (`/settings`, the "Settings" link in the bar) are one area for the account pages (`/account`, `/account/email`, ...) and the
  website preferences (`/settings/events-mode`, `/settings/altitude`, `/settings/messages`, saved into `user_profiles`; code in
  `server/src/repo/settings.ts`, `routes/settings.tsx`, `views/SettingsPages.tsx`). The list is `views/settingsSections.ts`, the frame
  `views/SettingsShell.tsx`: wide screens show the list at the left of every page, phones show `/settings` as the list alone (label,
  description, current value) and each page alone with a way back. Altitude "kilometers" is stored as `m` (legacy: the map shows km).
  Every change is audited (`settings.changed`).
- Home page task panels (`routes/events.tsx`, `views/UserHomePage.tsx`): single-event mode shows "Today Task" (waypoints loaded, task set, `getTodayTask`), multiple-events mode "My events" with "Create new event" (POST `/events`, next free `Event 01`). The "Switch to the ... mode" at the bottom of each is a POST `/events-mode` (same setting as Settings, audited `settings.changed`) written like a link.
- Group editor (`/groups/:id`, code in `routes/groups.tsx`, `repo/groupEditor.ts`, `repo/trackerInput.ts`, `views/GroupPages.tsx`): "Create new group" on the home page
  is a POST to `/groups` (next free `Group 01`, new groups are unlisted, owner-defined messages follow the settings default) and lands in the editor. The owner edits
  the settings (name, public / unlisted, messages; a card at the left on wide screens, the trackers list and the add form at the right, all stacked in that order on phones), turns the trackers on and off as in the legacy page (a "Turn the trackers on & off" button opens a checkbox per tracker with Save, Select all, Select none and Cancel; the checkboxes are always in the page, shown by `data-selecting` on `#trackers`, which the script sets and `?onoff=1` sets without it; one POST to `/trackers/on-off` with the checked ids)), renames and deletes (every row holds a hidden rename form that `group-editor.js` shows in place, and Delete (a tracker, or the group, here and in the home page's group list) asks in one Bootstrap modal (`#ft-confirm`, `ConfirmDialog` in `views/confirmDelete.tsx`, opened by `public/js/confirm-dialog.js`) filled from the link's `data-confirm-*` attributes (`views/confirmDelete.tsx` holds the wording once, for the dialog and for the confirmation pages); without JavaScript `?rename=<id>` and the confirmation pages do it; the script also sends the tracker changes with `fetch` and swaps `#ft-head`, `#ft-flash`, `#trackers` and `#add-tracker` for those of the answer, which is the whole page, so refused changes come back with their errors: keep those ids; see Submit buttons below) and adds
  one (SPOT / inReach radios that `public/js/group-editor.js` sets while typing; without a choice the server tells the type from the text: Garmin link or `#` = inReach, which needs the IMEI after `#`; otherwise a 20 to 50 character SPOT id). Admins and `SpotIdReaders`
  members get the same page read-only (plain text, no controls; every POST is refused with `/403`); anybody else gets `/403`. The legacy live check of a new tracker's feed
  waits for the tracker polling. Every change bumps `groups.version` and is audited (`group.*`, `tracker.*`); feed ids are never logged. The task of the group's map (`#task`, left column under the settings; `repo/events.ts` `assignEvent`, `ensureDefaultEvent`, `createEvent`, `repo/groupEditor.ts` `getGroupTask`): single-event mode = a checkbox "Display the Today Task" (POST `/groups/:id/task`, the owner's default event, made on first use); multiple-events mode = a choice of the owner's events, none, or "Create a new event and use it" (POST `/groups/:id/event`, `-1` = new). Choosing an event makes it the owner's default (legacy `AssignEventToGroup`); a new group shows the default event (single mode: made if need be). Audited (`group.task`, `group.event`, `event.created`). Not built yet: the event pages (`/events/:id`, `/events/default`, waypoints, task editor: the links to them 404), "set for all my groups".
- User management for admins (role `Admins`, the "Admin" link in the bar): `/admin` lists and searches users (sortable by clicking a column header: server-side, `?sort=username|email|roles|groups|locked|lastLogin&dir=asc|desc`, a "Sort by" row replaces the headers on cards; an experiment that may spread to the other tables), a sticky bar under the search box holds the user count and the paginator (First, Prev, Page [n] of N, Next, Last; 50 per page, a page number past the end shows the last page), `/admin/users/:id` is laid out like the settings (the `ft-settings*` styles): wide screens list the sections at the left of every page (the overview at the right on the index), phones show the list alone with the current values and each section alone with a way back. One page per change (`/admin/users/:id/<section>`: lock / unlock, password reset link, set password, email change by confirmation link, email confirmed, log out everywhere, two-factor off). The POSTs go to `/lock`, `/unlock`, `/reset-link`, `/password`, `/email`, `/email-status`, `/end-sessions`, `/disable-2fa`. Each form is in a red frame under a red "Admin area" banner and needs the target's user name typed in; an admin cannot change their own account there; each change is audited (`admin.*`). Code: `server/src/routes/admin.tsx`, `views/AdminPages.tsx` (list), `views/AdminUserPages.tsx` (one user), `repo/adminUsers.ts`. Roles are not editable yet.
