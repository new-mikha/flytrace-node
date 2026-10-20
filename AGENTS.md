# FlyTrace (Node + Postgres rewrite): agent instructions

Rewrite of the legacy ASP.NET site https://www.flytrace.com/tracker. Read `README.md` for setup and
`docs/legacy-system.md` (how the old system works) before porting any feature.

Paths in this file are relative to the directory containing it (`flytrace-node/`), even when it is loaded
from a parent workspace folder.

## Rules

- **Never run git commands that change the repository** (commit, add/stage, reset, checkout, stash, merge, rebase,
  push, tag, branch changes). The owner handles all git writes. Read-only git (`status`, `diff`, `log`, `show`)
  is fine. If work is ready to commit, say so and stop.
- Go slow: milestone 1 is the migration plus bare auth/role skeleton pages. Do not add map, tracker polling,
  registration or group management unless asked.
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

The schema is not deployed yet, so `db/migrations/0001_schema.sql` is edited in place; once deployed, add new
numbered migrations instead.

## Auth model

- Server-side sessions (not JWT): cookie `flytrace.sid` = signed session id; data in the Postgres `sessions` table.
- Login accepts username or email (both unique, case-insensitive). Legacy hashes `flytrace1|...` are verified
  and upgraded to argon2id on first login. Roles come from `user_roles`, loaded from the DB on every request.
- Registration (later) must reject a username equal to another user's email.
- Code: `server/src/auth/` (`password.ts`, `service.ts`, `session.ts`, `guards.ts`, `routes.ts`).
