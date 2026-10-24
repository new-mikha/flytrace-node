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
- The menu bar is sticky. Logged-out visitors get a text toggle "Log in, Register, etc" on small screens, logged-in
  users the burger icon and a drop-down named after their username (account pages and Log out).
- `public/js/app.js` shows a spinner and disables only `.btn` elements (never plain links), plus the loading bar at
  the top; a new click cancels the pending navigation, a form POST is never cancelled.
- Day / night theme: the `ft-theme` cookie (`dark`, anything else means day; day is the default whatever the browser
  prefers). The server puts Bootstrap's `data-bs-theme` on `<html>` (an `onSend` hook in `app.ts`), `app.js` switches it
  in place, `/theme` does it without JavaScript. Our own colours get a `[data-bs-theme="dark"]` variant in `flytrace.css`:
  do the same for any new hard-coded colour.
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
  (`index.ts`). Production lines carry ISO times with the offset. Pages print times in UTC explicitly, so they are unaffected.
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
