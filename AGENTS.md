# Flytrace (Node + Postgres rewrite): agent instructions

Rewrite of the legacy ASP.NET site https://www.flytrace.com/tracker. Read `README.md` for setup and
`docs/legacy-system.md` (how the old system works) before porting any feature.

Paths in this file are relative to the directory containing it (`flytrace-node/`), even when it is loaded
from a parent workspace folder.

## Rules

- Go slow: do not add map, tracker polling or group management unless asked, and do not add features nobody
  asked for (the owner prefers less: e.g. no "Remember me").
- The idea behind the whole site: as few clicks and round trips as possible to set things up (a new event, its waypoints, its task). When
  porting or adding a page, keep the legacy shortcuts (e.g. "Load waypoints first" takes a file right on the event page and sends it as soon
  as it is chosen) and do not make the person go to another page first.
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
- `npm run user:create -- <name> <password> [role]`: dev user. `npm run dev`, `npm test`, `npm run typecheck`. `npm run test:e2e` runs the browser tests in `server/e2e/` (the bulk buttons, the waypoint upload, the waypoints manager and its add form) (`*.e2e.ts`, `vitest.e2e.config.ts`): a real server on a free port and a real Chrome through `playwright-core` (installed Google Chrome; `PLAYWRIGHT_CHROMIUM_PATH` for another binary). They are not part of `npm test`, and need no server of yours running.
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

`DATABASE_URL` points at `127.0.0.1`, not `localhost`: on the owner's Mac, opening a new connection to `localhost` stalled for exactly 5 seconds about once in 30 runs of the tests, in the name lookup (caught on 6 Nov 2026 with a tracer in the test process; 72 clean runs with the address). A test that fails with "timed out in 5000ms" on a machine with `localhost` there is most likely that.

Tests run against the dev database and share one rate limiter per client IP, so tests that log in or post give each
simulated client its own `remoteAddress`.

## Code style (enforced by tools)

- After changing code, run `npm run format` (`eslint --fix`, then `prettier --write`); `npm run format:check` only reports. Config:
  `.prettierrc.json` (layout, 100 columns, line endings kept) and `eslint.config.js` (the `curly` rule only). Do not hand-format against it.
- Braces: one statement, no braces; if any block of an if / else if / else chain needs braces (several statements), all of them get braces
  (ESLint `curly`). The owner would also like the statement after `if` / `else` / `for` on its own line and the brace on its own line after a
  multi-line condition, but Prettier cannot do that (it was tried with dprint, see git history `5be71c5`); do not fight Prettier over it.
- Lines are at most 100 columns; comments, long strings, SQL and regexes may run over (the tools do not wrap them).
- One class per file, the file named after it (`tracker.ts` for `Tracker`). A small helper class in a test file is fine.
- VS Code: `.vscode/` recommends the Prettier and ESLint extensions and formats on save.

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
  everything) appears under a "Hide ..." button. The map is a "Public map" link in the last column there, as in the own groups table and in legacy, and the name is plain text; admins also get a "Definition" link to `/groups/:id` before it. Anonymous visitors keep the public maps, whose names are the links, with the in-place swap.
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
  (`index.ts`). Production lines carry ISO times with the offset. Times on pages (`views/format.ts`, `formatTimestamp`) use the same zone, show a readable name for it (`UTC`, `AEDT`, `CET`; `Intl` knows an abbreviation only in some locales, so `zoneName` tries several, and a zone with none keeps `GMT+8`) and add the year when it is not the current one.
- ERROR is for a person to look at: it is meant to reach an email one day (see "Planned"). As many WARNs as good logging needs, then at most one ERROR about them, never one per failure. Failures outside our control (a feed down, one bad email address) are WARNs. `Pipeline` shows the pattern: the first poll that throws is an ERROR, the rest of that run WARNs.
- When you start a test server, set `SMTP_HOST=` on its command line so that it does not send real email through
  the owner's SMTP account (it reads the owner's `.env`).

## Decisions (do not re-propose)

- The authenticator (TOTP) secret stays stored unencrypted in `users.two_factor_secret`.
- No JSON login API, no "Remember me", no stored procedures or triggers.
- Legacy rows whose names are the literal text `${output}` (broken client tool, many users) are kept as they are.
  The import renames duplicate names (`X (2)`, ...) and prints each rename.
- The coordinates endpoint always sends the **full list** of the group's latest positions. The legacy incremental
  protocol is not ported: no global revision counter (`revision.bin`, `RevisionPersister`, the round-up to the next
  hundred), no seeds, no `Src` / `Res` / `"NIL"`, no `IncrTest` / `IncrSurr` surrogate self-test, no `TestCheck`,
  no `IsAlwaysFullGroup`. Reason: legacy production ran with `IncrDebugRatio = 1` for years, which sent every
  tracker on every call anyway, so the incremental path's output was never actually exercised; and the saving is
  tiny — the largest captured full response (42 trackers) is 27 KB of JSON but **858 bytes gzipped**. `StartTs` is
  sent unconditionally (the legacy `Src == null ? StartTs : null` rule goes with the seeds). `groups.version` stays
  for cache invalidation, but is no longer part of the wire protocol: the client drops trackers missing from a full
  response, so removals self-correct. Do not confuse it with the separate `Ver` field (the service's own API version,
  which makes the map page reload after a deploy). See `docs/legacy-coordinates-api.md` for how the legacy one worked.
  If bandwidth ever does matter, the fallback is **not** to revive seeds: a full response is viewer-independent
  (every gating decision reads the group's own settings), so (1) an nginx micro-cache keyed on the group id, with a
  TTL of a few seconds, is invisible because ages render in whole minutes, (2) the payload can be serialized once per
  group and reused for every viewer, and (3) a weak `ETag` over the group's data state plus `If-None-Match` gives the
  `"NIL"` case back as a 304 — handle that 304 explicitly (`cache: 'no-store'` and a stored tag), because a browser
  serving the cached body transparently would freeze the displayed ages.
- **Tracker snapshots and tracks live in memory only. There is no table of track points** — do not propose one (for
  history, for gap filling, or as a cache of last-known positions). Reason: if a point is not coming from the source
  service it can be ignored, and the existing client was tuned against a server that held nothing but what the source
  had just handed it. One snapshot per tracker (current point, previous point, type, user message, error, and the full
  track newest-first, trimmed to 48 h behind its own newest point, merged on each poll by union on timestamp as
  `SpotLocationRequest` does); evicted after ~20 minutes without a viewer, tracks included. No snapshot means
  `Type: "wait"` — the absence of data, not a rule we add. Both endpoints read the same snapshot object, which is what
  keeps them consistent: the client only stops re-asking for a track once its newest point reconciles with the marker.
  **Why a points table is actively wrong, not merely unnecessary:** our data's staleness follows who has been
  watching, not the tracker's activity (we only poll while a map is open), so a stored "last known position" can be
  months old while the tracker flies daily. Serving it would anchor the map's auto-fit (`_succCallTime == null`, fires
  once) on the wrong continent, let "Show tracks" fetch an ancient track, and then draw a 20,000 km segment when the
  real position arrives 30 seconds later. `Type: "wait"` makes all of that structurally impossible, and
  `isHavingCoordinates` already excludes such trackers from track requests. Filling a long silence is the source's
  job: SPOT pages back on a tracker's first fetch (up to 6 pages of 50, while the span is under 48 h), inReach
  requests a 4-day window outright. The one exception, and not a reintroduction of the above: `feed_polls`
  (`tracker_type`, `foreign_id`, `last_polled_at`) records when each feed was last polled, so a restart does not
  re-hit a feed sooner than the interval we impose on ourselves (SPOT: 150 s per feed). Read at startup only, keyed
  by the feed rather than by a `group_trackers` row because one feed in several groups is polled once for all of
  them, and holding no positions and no tracks. Request timeouts are **10 s per HTTP request and 60 s for a whole
  SPOT paging chain** (legacy: 55 s and 60 s) — one `AbortSignal` shared by every page of the chain. No backoff
  after failures, as in legacy (decided 4 Nov 2026, with the rest of the legacy timing rules: see "Tracker sources and
  polling"). See `docs/legacy-coordinates-api.md` §7.0.
- **Exactly one app process: tracker polling runs inside the web process, and the app is never run as more than one
  instance.** No Node clustering, no second instance behind nginx, no `pm2 -i`. Two instances would each keep their
  own snapshots and each poll the same feeds, doubling traffic to SPOT and Garmin (which have rate limits we do not
  understand) and giving viewers different answers depending on which process they reach. The poller lives in the web
  process on purpose: snapshots are in memory (see above), and both endpoints reading the same snapshot object is what
  keeps them reconciled, so a separate poller process would need the snapshots serialized across a boundary — the
  storage layer we removed, in another form. Only a genuine need to scale out horizontally justifies splitting the
  poller off, and that is the moment to design the sharing, not before; on the Pi it does not arise. Nothing in the
  code enforces this beyond the port: a second process on the same port dies at `listen`, before polling starts, and
  that is enough (a Postgres advisory lock was built and removed on 5 Nov 2026 as not worth the code). A second process
  on another port does poll, so keep test servers short.
- **There are two tracker types, `'S'` (SPOT) and `'G'` (Garmin inReach). There is no `'T'` for test.** Legacy has a
  third source type in code (`ForeignId.TEST`, a synthetic group built from captured SPOT XML in `App_Data/test/` so
  the map could be watched without network) but it was never a database value: `GroupFacade` maps the column strictly
  to `S` or `G` and drops anything else with an error, and `manageGroup.aspx.cs` only ever writes those two. We do not
  need it — a fake source needs no source type of its own, because it is a fake *transport* for a real source, which
  is what `TestLocationRequest` was (it wraps `SpotFeedRequest` with the XML handed in as a string instead of
  fetched). Fakes go in at the HTTP seam or by swapping the source registry in dev and tests.
- **Development may poll the real SPOT and inReach feeds.** The owner has always done so and asks for it; do not route
  dev through sample data by default. Beware only that watch mode forgets the in-memory same-feed timer on every
  restart, so a map left open while editing can out-pace the 150 s rule; `feed_polls` is what blunts that.

## Tracker sources and polling

Agreed on 4 Nov 2026; it is built (`server/src/tracking/`), with its tests in `server/test/tracking/`. Change it by this design rather than inventing a new shape. The legacy mechanics are in `docs/legacy-coordinates-api.md` (§4 snapshots, §5 fetching
rules, §5.2 the deployed numbers, §5.3 one fetch in detail, §7.0 what we changed). **The timing rules are the legacy
ones, kept on purpose** ("if it works, it works"; errors will show in the log).

Layout: `server/src/tracking/` with `tracking.ts` (the shared map, class `Tracking`), `tracker.ts` (one feed, class `Tracker`), `pipeline.ts` (one per
source: its queue, its loop at the source's start gap, its in-flight count), `merge.ts` (fold fresh points into a track), `sources/`
(`types.ts`, `http.ts` the one request and its failures, `spot.ts`, `inreach.ts`, `index.ts` for the registry),
`mapResponses.ts` (the replies to the map page's two requests); pages and endpoints in `routes/map.tsx`. `Tracking.start()` is called
by `index.ts` only, so `buildApp` alone (tests) never polls: every tracker stays `wait`.

```ts
export type SourceType = 'S' | 'G';

export interface TrackerSource {
  readonly type: SourceType;
  readonly name: string;                 // "SPOT", "Garmin inReach"
  readonly rules: {                      // the legacy numbers, both sources
    startGapMs: number;                  // 2_000: between two request starts of this source
    maxInFlight: number;                 // 10
    feedIntervalMs: number;              // SPOT 150_000, inReach 30_000: from the start of the feed's last call
    callTimeoutMs: number;               // the whole call, all its requests: SPOT 60_000, inReach 25_000
  };
  poll(feedId: string, held: HeldTrack | null, signal: AbortSignal,
       onLatest: (points: FeedPoint[]) => void): Promise<FeedResult>;
  parseFeedId(text: string): { feedId: string } | { error: string };
}
```

**The map of trackers** (`tracking.ts`, shared by all sources):

- Keyed by the **feed**, `S:<feedId>` or `G:<feedId>`, never by a `group_trackers` id: the same feed in several groups
  is one `Tracker`, polled once (legacy: `ForeignId`), and `feed_polls` is keyed the same way. The pilot's name comes
  from the group's row when answering, since two groups may name the same feed differently.
- A coordinates or tracks request looks up each feed of the group. Found: answer from it. Missing: create a `Tracker`
  and answer `wait` (`Type: "wait"`). Neither endpoint ever waits for a poll; the client retries (`main.js` keeps
  `needGetTrack` and asks again at most every 30 s).
- Each access calls `tracker.resetRemovingTimer()`: clear `_removeTimer`, then `setTimeout` 20 minutes (legacy
  `TrackerLifetimeWithoutAccess` = 20, in its production config too). When it fires: `trackers.delete(key)` and
  `_removed = true`. A removed `Tracker` is never queued or polled again; a later request makes a fresh one that
  starts from `wait`.
- No enumeration of the map in normal running: every `Tracker` is driven by its own timers. (Shutdown may go through
  it once to clear them, or the timers are `unref()`ed.)

**One pipeline per source** (`pipeline.ts`, independent timelines, a generic class fed the source's `rules`):

- A queue (a plain array) holding only trackers that are **due**. A new `Tracker` gets
  `dueAt = last_polled_at + feedIntervalMs` (`feed_polls`, read at startup; 0 when unknown): already due, it goes to
  the end of the queue (new arrivals of one request sorted by `dueAt`); not yet due (a restart within the interval),
  a `setTimeout(dueAt - now)` puts it at the end when it is.
- The main loop is a `setInterval(startGapMs)` (2 s). Each tick: drop `_removed` heads; if the queue is not empty and
  in-flight < `maxInFlight`, take the head and start its call. At most one start per tick, which is the legacy 2 s
  start-to-start rule; up to 10 calls overlap only when calls are slow. An empty queue costs up to 2 s of latency,
  accepted for the simplicity.
- Starting a call: in-flight + 1, `tracker.inFlight = true`, upsert `feed_polls.last_polled_at = now`, and
  `setTimeout(feedIntervalMs)` (re-poll timer). When the re-poll timer fires: set `dueAt = now` and put the tracker
  at the end of the queue; if its call is somehow still running, log a **WARN** and let the end of the call queue it
  instead (it must never be hit twice at once).
- Ending a call (success, error or timeout, in a `finally`): in-flight - 1, `tracker.inFlight = false`, store the
  results (current and previous point, type, user message, error, track) in the `Tracker`.
- Startup refuses a source whose `callTimeoutMs` is not shorter than its `feedIntervalMs`.
- **No backoff**, as in legacy: a failing feed is retried on its normal interval for as long as someone watches it.
  Every error is logged with its status and all response headers (see below).

**Timeouts**: Node's `fetch` with `AbortSignal`s. One signal per call,
`AbortSignal.any([AbortSignal.timeout(callTimeoutMs), shutdown.signal])`, and per HTTP request
`AbortSignal.any([callSignal, AbortSignal.timeout(10_000)])` (10 s per request, 60 s per call; legacy 55 s and 60 s).
The signal also covers reading the body. A timeout rejects with `TimeoutError`, a shutdown with `AbortError`;
`shutdown` is aborted from an `onClose` hook, together with `clearInterval` of the loops, so `app.close()` does not
wait on feeds.

**What a call fetches** (inside the source; the pipeline sees one call):

- **SPOT**: on a tracker's **first** fetch (no track held yet), the paging chain: pages of at most 50 messages, page
  *n* is `?start=n*50+1`, the next page starts as soon as the previous one is in (no gap, as legacy), and only while
  the page came back full, the merged span is still under 48 h and fewer than 6 pages were read (legacy
  `Iteration < 5`). **After that, the top page only**, merged into the held track. Accepted edge case: a watched
  tracker that goes without a successful poll for longer than one page covers (50 messages, about 2 h of 2.5-minute
  tracking) keeps a hole in its track; a new `Tracker` (after the 20 minutes) pages again.
- **inReach** (§5.3): on a **first** fetch, two requests: without `d1` for the latest point, then a 4-day window (`d1`)
  back from it. **With a track held, one request, always with `d1`** = newest held point minus 4 days, as legacy's first
  request: if its newest `Id` is the newest held, stop; otherwise its points are sanitised against the held track and
  merged. A bigger answer on every poll, chosen on purpose (4 Nov 2026): a plain request gives one point, so the marker
  would run ahead of the track and `prev` could claim the held point when others came between, which makes `main.js`
  skip those points for good. Legacy's second request is not needed: this window already holds every new point.
- **On a first fetch the latest point is known before the track**: `onLatest` hands the first response's points to the
  `Tracker`, which updates the current and previous point, type, message and time straight away (the coordinates
  endpoint serves them). There is **no track at all until the chain is done**: the client asks for tracks with
  `laterThan` = its newest point, so a page-1-only track would leave the older pages missing for good. Meanwhile
  `main.js` keeps asking. A first fetch that fails half way keeps the position it got and starts again next time, still
  with no track. Once a track is held, the position and the track change together, when the call ends.
- **`merge.ts` decides what we keep**, once for every source: union on timestamp, newest-first, trimmed to 48 h
  behind the newest point. The source returns points, never a merged snapshot.

**The rest of the interface**:

- **`FeedResult` is `{ points: FeedPoint[]; error: FeedError | null; requestCount: number; warnings?: string[] }`**,
  points newest-first, `warnings` for the log only (an inReach point that moved in time; repeated times are common and
  not reported), and **`points` and `error` may be set at once** (legacy: a snapshot carries a stale position and a fresh error, which the client
  renders). `FeedError` is a closed union (`bad-feed-id`, `no-data`, `throttled`, `unauthorized`, `timeout`,
  `source-error`, `network`) with `userMessage` plus `status`, `headers` and `retryAfterMs` when present. Legacy
  classified only HTTP 404.
- **Log every error code and every response header, for both sources** (the owner asked for this explicitly). Neither
  service documents a 429 or a `Retry-After`, so the first real one has to be captured in full rather than guessed at.
  The polling's log lines name the tracker by its key, `S:<feedId>` or `G:<feedId>` (for inReach that holds the IMEI):
  the owner's choice (5 Nov 2026), so the log can tell the feeds apart. Audit lines and what the map shows still never
  hold a feed id.
- **`parseFeedId` belongs to the source** (SPOT's 20-50 character id, Garmin's MapShare URL plus the IMEI after `#`),
  moved out of `repo/trackerInput.ts`. Choosing *between* sources when the owner picked no radio button stays central:
  that is arbitration, not source knowledge. The radio buttons themselves stay hardcoded in the view.
- **The registry is `Record<SourceType, TrackerSource>`**, keyed by the same `char(1)` as `group_trackers.tracker_type`
  and `feed_polls.tracker_type` (legacy: `ForeignAccessCentral.LocationRequestFactories[type]`). **The test of whether
  the abstraction holds: no `if (type === 'S')` anywhere outside `sources/`.** The pipeline sees only `rules`, `poll`
  and `FeedResult`; anything else that needs to branch on source means the interface is missing a member.
- **Tests** (`server/test/tracking/`, shared bits in `helpers.ts`): vitest fake timers drive the pipelines, so the 20 minutes take no time; `fetch` is stubbed (`vi.stubGlobal`) and sources are swapped in the registry, so there is no real
  network. `tracking-db.test.ts` runs the `feed_polls` SQL on the dev database, the one place the pool is real. `AbortSignal.timeout` is not faked by vitest: spy on it and return a controller's signal.
- **Every coordinates answer is noted** (`recordMapUpdate`, legacy `UpdateStatFields`, not waited for; a failure is a WARN): `page_updates_num` + 1, and `newest_coord_ts`, `newest_lat`, `newest_lon` from the newest position in the answer (turned off and hidden trackers count), which the public maps on the home page go by. An answer with no position, as after a restart, leaves them.
- **Not built**: the live check of a new tracker's feed.
- **The parser fixtures come from legacy** (`server/test/fixtures/feeds/`: `LocationLib.Test/BasicRequest.xml`,
  `Combinations.xml` and `InReach/*.kml`), the only feed-level samples that exist: `legacy-xml-samples/` holds responses from *our* endpoints, not
  from theirs. They are slimmed and anonymised, with positions and timestamps real so the tests stay meaningful. Do the same to any new one.

## Planned (not started)

- A production build step (`npm run build`, probably Vite or esbuild), to be done late, once the pages have settled:
  one minified CSS file and one JS file instead of the separate Bootstrap, Font Awesome and our own files; a Font
  Awesome subset with only the icons we use; versioned file names (`app.<hash>.css`) read from a manifest by `Layout`
  in production only, so that `/assets/` can be cached for a year. Dev keeps serving the separate files from
  `node_modules`. Compression (gzip or brotli) and the cache headers go in nginx or `@fastify/static`. Do not start
  this unless asked.

- Log files and email for WARN and up (talked through on 6 Nov 2026; not to be started unless asked):
  - Rolling files per level, `info.log`, `warn.log` and `error.log` (`pino-roll`, only when a `LOG_DIR` is set), next to stdout.
  - In `Pipeline`, per source: consecutive failures with one ERROR at a threshold ("inReach: 10 failures in a row, last: timeout") and one line on the first success. `no-data` and `bad-feed-id` do not count: the service answered. Per source because the failures of one feed say nothing, and legacy's `ConsequentErrorsCounter` (thresholds 5, 5 and 1 for timeouts) was shared by both sources by mistake.
  - One ERROR per source at most every hour or so for a 429, 401 / 403 or a `Retry-After`, with the status and all the headers.
  - Email: a small buffer sent every 30 minutes on its own timer, as legacy's `SmtpAppender` (512 events, 30 minutes) but with no event stuck in it. Repeated lines become counts, and the email's own failures stay out of it. It cannot tell of a crash or a dead SMTP: that needs an outside uptime check.
  - Odd feeds: legacy's `WeirdThingsReporter` (WARN once per id, then INFO for 7 days, kept in a file) is the model if the warnings of `FeedResult` get too many.
  - Fastify logs every 500 as an ERROR on its own, so a database outage gives many: the email's counts must absorb that.

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
  the settings (name, public / unlisted, messages; a card at the left on wide screens, the trackers list and the add form at the right; the task / event under the settings on wide screens; phones stack settings, trackers, add form, task), turns the trackers on and off as in the legacy page (a "Turn the trackers on & off" button opens a checkbox per tracker with Save, Select all, Select none and Cancel; the checkboxes are always in the page, shown by `data-selecting` on `#trackers`, which the script sets and `?onoff=1` sets without it; one POST to `/trackers/on-off` with the checked ids)), renames and deletes (every row holds a hidden rename form that `group-editor.js` shows in place, and Delete (a tracker, or the group, here and in the home page's group list) asks in one Bootstrap modal (`#ft-confirm`, `ConfirmDialog` in `views/confirmDelete.tsx`, opened by `public/js/confirm-dialog.js`) filled from the link's `data-confirm-*` attributes (`views/confirmDelete.tsx` holds the wording once, for the dialog and for the confirmation pages); without JavaScript `?rename=<id>` and the confirmation pages do it; the script also sends the tracker changes with `fetch` and swaps `#ft-head`, `#ft-flash`, `#trackers` and `#add-tracker` for those of the answer, which is the whole page, so refused changes come back with their errors: keep those ids; see Submit buttons below) and adds
  one (SPOT / inReach radios that `public/js/group-editor.js` sets while typing; without a choice the server tells the type from the text: Garmin link or `#` = inReach, which needs the IMEI after `#`; otherwise a 20 to 50 character SPOT id). Admins and `SpotIdReaders`
  members get the same page read-only (plain text, no controls; every POST is refused with `/403`); anybody else gets `/403`. The legacy live check of a new tracker's feed
  waits for the tracker polling. Every change bumps `groups.version` and is audited (`group.*`, `tracker.*`); feed ids are never logged. The task of the group's map (`#task`, left column under the settings; `repo/events.ts` `assignEvent`, `ensureDefaultEvent`, `createEvent`, `repo/groupEditor.ts` `getGroupTask`): single-event mode = a checkbox "Display the Today Task" (POST `/groups/:id/task`, the owner's default event, made on first use); multiple-events mode = a choice of the owner's events, none, or "Create a new event and use it" (POST `/groups/:id/event`, `-1` = new). Choosing an event makes it the owner's default (legacy `AssignEventToGroup`); a new group shows the default event (single mode: made if need be). Audited (`group.task`, `group.event`, `event.created`). Not built yet: "set for all my groups".
- Event page (`/events/:id`, `/events/default` makes and opens the default event; code in `routes/events.tsx`, `repo/eventEditor.ts`, `views/EventPages.tsx`, `public/js/task-editor.js`): owner only (404 otherwise); single mode shows only the default event (titled "Today task", no name or delete), multiple mode adds `#details` (rename, "Delete the whole event" through the confirm dialog, refused in single mode). `#task`: rows of waypoint select + radius (empty = 400, 1 to 100000, max 500 points), saved by delete-all-and-reinsert (POST `/events/:id/task`, `wpt[]` and `radius[]`); the last line is always blank ("Add new ->"), Clear task and bulk fill need JavaScript (`ft-needs-js`; `ft-js` is set on `<html>` by the script). `guard.js` fires a bubbling `ft-changed` event on `data-guard="changed"` forms so a script can decide "changed" itself (rows come and go; `data-initial` holds the saved `id:radius` list). An event with no waypoints shows `#load-waypoints` ("Load waypoints first") instead of `#task`: a file input (`data-autosubmit`: `app.js` sends the form as soon as a file is chosen; the button is for no-JavaScript) posting multipart to `/events/:id/waypoints/upload` (`@fastify/multipart`, up to 4 MB). `repo/waypointFiles.ts` parses KML, CUP and GPX with the rules of the legacy `WaypointsLoader.cs` (name + position + altitude required; the same name twice in a file only with the same values; GPX name falls back to the description and CIVLID / COMPID entries are ignored; a CUP first line that fails is taken for a header and `---` ends the waypoints; the CUP name is the code, else the long name), `loadWaypoints` in `repo/eventEditor.ts` adds new waypoints in file order (so id order = file order) and replaces same-name ones (any case), or keeps them with `existing=skip` (for the waypoints page later); errors come back as a 422 page with the reason; audited `event.waypoints-loaded` (counts only). When the waypoints page is built: a legacy bug report said the edit form dropped a zero right after the decimal point (-26.06966 became -26.6966, and the map failed with "_task is not defined"), so never split a coordinate as text; the upload is tested for it (`event-page.test.ts`, `waypoint-files.test.ts`). `#old-points`: hide points older than now minus 0/1/2/3/5/24 hours (sets `events.start_ts`) and restore (NULL). Every change bumps the version of the groups showing the event and is audited (`event.renamed`, `event.task`, `event.hide-old`, `event.restore-old`, `event.deleted`, `event.denied`). In-place ids: `ft-head ft-flash details`, `ft-flash task`, `ft-flash old-points`: keep them.
- Waypoints manager (`/events/:id/waypoints`, `/events/default/waypoints` opens the default event's; code in `routes/waypoints.tsx`, `repo/waypoints.ts`, `geo/coords.ts`, `views/WaypointPages.tsx`, `public/js/waypoint-editor.js`): owner only, same single-mode rule as the event page. Sections `#load` (the file upload with Skip (default) / Replace existing, posting to `/events/:id/waypoints/upload` with `back=waypoints`: that field and `existing` must come before the file in the form), `#waypoints` (the sortable table, `?sort=name|lat|lon|alt|description&dir=`, cards below xl; Edit opens one row's form in place: `?edit=<id>` renders it, the script fetches that page and swaps `#waypoints`; Delete through the confirm dialog) and `#add-waypoint` (altitude starts at 0; the row just added or updated is marked once by the page that follows (`session.highlightWaypoint`, never kept for a later visit); the script keeps the mark while the page stays open (`ft-wpt-keep`); waypoints in the task are shaded amber (`ft-wpt-used`)). The coordinates format list (`user_profiles.coord_format`, POST `/events/:id/waypoints/format`, a `<select data-autosubmit>`) and the default hemispheres (`def_hemisphere_ns/ew`, set from each added waypoint) are the owner's preferences. `geo/coords.ts` shows and parses the three formats (Deg, DegMin, DegMinSec) from decimal fields, never by splitting text (the legacy leading-zero bug), with rounding carry. A waypoint in the task cannot be deleted (legacy message); names are unique per event in any case; every change bumps the group versions and is audited (`waypoint.added|updated|deleted|deleted-all`). "Delete all waypoints" sits in `#load`. In-place ids: `ft-flash load waypoints add-waypoint`: keep them.
- Map page (`/map/:id`, public like the legacy one, a group that does not exist goes to `/`; code in `routes/map.tsx`, `views/MapPage.tsx`, `repo/mapGroups.ts`, `tracking/wire.ts`, `tracking/mapResponses.ts`, `public/js/map/`, `public/css/map.css`): a document of its own, not `Layout`, whose ids and classes are the legacy ones because the script builds the screen from them (so no `ft-` prefix, and no dark theme: the legacy colours stay). `public/js/map/main.js` is the legacy `Tracker/Scripts/main.js`, and **its diff against that file is kept small and meaningful** (the owner reads it): changed so far are the marker image paths (`/assets/img/map/`), the three server calls (now `TrackerApi.getCoordinates / getTracks / testCheck` from `tracker-api.js`: plain `fetch`, ISO date text turned back into `Date`s, the callbacks as before) and the reload when `Ver` changes (the legacy ASP.NET postback of three hidden fields became a `{lat, lon, zoom}` in the tab's `sessionStorage` (key `ft-map-view-<group>`), written before `location.reload()` and read and removed by `initialize`, so it is used once and a later visit starts afresh). The legacy incremental code (`Src`, `Res`, `"NIL"`, `IncrSurr`, `IncrTest`, `_currentSeed`, the self-test report) is gone from it, and `StartTs` is compared by time, not by object, since it is read on every answer now. `labelMapControl.js`, `buttonMapControl.js` and `public/third-party/date.format.js` (Levithan, MIT, so that folder is skipped by the license test) are unchanged legacy copies (LF endings only); all four are left out of Prettier and ESLint. `map-page.js` connects the buttons and starts `initialize()` on load (inline `on...` handlers do not type in Preact JSX). jQuery is the npm package, served at `/vendor/jquery/`. The requests: GET `/map/:id/coordinates` (always the whole group, see Decisions) and POST `/map/:id/tracks` (`{ items: [{ trackerName, laterThan }] }`, at most 10). The wire names are camelCase (the legacy ones were capitalised, so the renaming touches most lines of `main.js`: it was done mechanically, as one commit), `alt` is always metres, dates are ISO text, `ver` is the version after which the page reloads itself. **Empty values (null, false, 0, "", no time) are left out of the JSON**: `tracking/mapResponses.ts` `omitEmpty` drops them, `tracker-api.js` puts back the zeros and `false` the script computes with (`lat lon age prevLat prevLon prevAge hidden`, track points `lat lon age`) and the rest (`alt type usrMsg error ts prevTs startTs altitudeUnits`) stays undefined, so `main.js` must test those for null (`prevTs` is guarded). The answers come from the polling (see "Tracker sources and polling"). `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_MAP_ID` in `.env` are needed in production (referrer-restricted browser key; the advanced markers refuse a map without a Map ID). **In development both can stay empty**: the page then uses Google's `DEMO_MAP_ID` (outside production only) and the map works with no key, watermarked "For development purposes only" and with a dialog "This page can't load Google Maps correctly" that can be closed (tried in a real browser: tiles, markers, labels and the map buttons all work). `_task` is the task of the group's event, written into the page as JSON (a flat list of name, lat, lon, radius; `getMapGroup`), so a name with a `'` no longer breaks the script as it did in legacy; an event with no task gives an empty list where legacy gave `null`, which `main.js` treats alike (it draws two waypoints or more). Not built: the view counter (`UpdateGroupViewsNum`), the logos, Google Analytics; `_mapCenterLat/Lon` of the legacy page were dead there and are not sent.
- User management for admins (role `Admins`, the "Admin" link in the bar): `/admin` lists and searches users (sortable by clicking a column header: server-side, `?sort=username|email|roles|groups|locked|lastLogin&dir=asc|desc`, a "Sort by" row replaces the headers on cards; an experiment that may spread to the other tables), a sticky bar under the search box holds the user count and the paginator (First, Prev, Page [n] of N, Next, Last; 50 per page, a page number past the end shows the last page), `/admin/users/:id` is laid out like the settings (the `ft-settings*` styles): wide screens list the sections at the left of every page (the overview at the right on the index), phones show the list alone with the current values and each section alone with a way back. One page per change (`/admin/users/:id/<section>`: lock / unlock, password reset link, set password, email change by confirmation link, email confirmed, log out everywhere, two-factor off). The POSTs go to `/lock`, `/unlock`, `/reset-link`, `/password`, `/email`, `/email-status`, `/end-sessions`, `/disable-2fa`. Each form is in a red frame under a red "Admin area" banner and needs the target's user name typed in; an admin cannot change their own account there; each change is audited (`admin.*`). Code: `server/src/routes/admin.tsx`, `views/AdminPages.tsx` (list), `views/AdminUserPages.tsx` (one user), `repo/adminUsers.ts`. Roles are not editable yet.
