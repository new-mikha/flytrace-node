# Flytrace (Node + Postgres rewrite)

Rewrite of https://www.flytrace.com/tracker (ASP.NET WebForms) on TypeScript, Fastify and Postgres.

**Milestone 1 (current):** organised legacy data migration plus a bare skeleton proving authentication
(migrated users keep their passwords) and role-based authorisation (anonymous / user / `Admins`).
No tracker polling or map yet.

## Setup

```sh
cp .env.example .env            # then set SESSION_SECRET
npm install
docker compose up -d            # Postgres 16 on localhost:5433
npm run db:reset                # dev only: drop, create, migrate (DB name must contain "_dev")
npm run db:import-legacy -- db/legacy/dump/<timestamp>   # see db/legacy/README.md
npm run dev                     # http://127.0.0.1:3000
```

Without a dump: `npm run user:create -- alice secret Admins`.

## Layout

- `server/src/` Fastify app: `auth/` (legacy + argon2 password verification, Postgres-backed sessions, `requireLogin` / `requireRole` guards), `routes/identity.tsx` + `routes/account.tsx` (log in with optional authenticator code, register, confirm email, forgot/reset password, My account), `mail/` (SMTP via nodemailer; logs instead when `SMTP_HOST` is empty), `routes/pages.ts` (bare pages `/groups`, `/admin`, `/403`).
- `server/src/views/` Preact (JSX) pages and components, rendered to HTML on the server; `server/src/repo/` SQL queries; `public/` our own CSS, JS and images (served at `/assets/`). Bootstrap and Font Awesome come from `node_modules` (served at `/vendor/`).
- `db/migrations/*.sql` schema, applied by `npm run db:migrate` (tracked in `schema_migrations`).
- `db/legacy/` migration from the original MSSQL database; `db/legacy/dump/` is gitignored (personal data).
- `server/test/` vitest: unit tests for password hashing and an end-to-end auth flow against the dev DB.

`npm test`, `npm run typecheck`.

## Legacy system reference

`docs/legacy-system.md` describes the original ASP.NET application in detail (data model, stored procedures, auth,
every page and feature, the map client, the SPOT/inReach feed clients, the polling scheduler and the incremental-update
protocol), plus the current migration status and the remaining work. Read it before porting any feature.

## License

Flytrace is free software under the GNU Affero General Public License, version 3 or (at your option) any later version
(`LICENSE`), the same as the original ASP.NET site. Every source file (`.ts`, `.tsx`, `.js`, `.css`, `.sql`, `.sh`) starts with the
license header; copy it from any file when adding one (a test checks that).
