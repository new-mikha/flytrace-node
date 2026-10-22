# Legacy data migration

Moves the original Flytrace database (ASP.NET membership + app tables on MSSQL) into the new Postgres schema.

## Files

| File | Purpose |
|---|---|
| `dump-all-tables.sh` | Fetches a fresh CSV dump from the old site (`migration.aspx`, needs `FLYTRACE_DUMP_API_KEY`). |
| `dump/<timestamp>/*.csv` | The dumps. **Gitignored**: they contain emails and password hashes. |
| `orig-mssql-db-script.sql` | Reference copy of the original MSSQL DDL incl. stored procedures. |
| `staging.sql` | `orig_*` tables mirroring the CSVs 1:1. |
| `transform.sql` | `orig_*` -> `users`, `roles`, `user_roles`, `user_profiles`, `events`, `groups`, `group_trackers`, `waypoints`, `tasks`. |
| `verify.sql` | Row-count and sanity checks; a failing check aborts the import. |
| `import-legacy.ts` | Runs the above in one transaction. |

## Run

```sh
npm run db:reset                      # dev only: drop + create + migrate (DB name must contain "_dev")
npm run db:import-legacy -- db/legacy/dump/20251101_181031
```

The import refuses to run into a database that already has users.

## CSV contract

- One file per table, header row, comma separated, UTF-8. Column order as in `staging.sql`.
- Booleans are `True`/`False`; empty fields are NULL; timestamps are `YYYY-MM-DD HH:MM:SS+00:00` (UTC).
- MSSQL "min date" sentinels (`1754-01-01 00:00:00+00:00`) appear in unused membership columns and are not carried over.
- `TrackerType` is `S` (SPOT) or `G` (Garmin inReach). `Altitude` is `m`, `ft` or empty (= don't show).

## Mapping notes

- Original ids are kept: user GUIDs become `users.id`, integer ids stay as they are (identity sequences are advanced afterwards),
  so old `map.aspx?group=N` links can be redirected 1:1.
- Passwords are stored as `flytrace1|<hash>|<format>|<salt>` and verified with the ASP.NET `SqlMembershipProvider`
  algorithm (format 1 = `base64(sha1(salt || utf16le(password)))`). They are re-hashed with argon2id on first login.
- `LastLoginDate` equal to `CreateDate` means "never logged in" in the old provider and becomes NULL.
- `users.email` is unique (login accepts username or email). The old data has exactly one duplicate pair,
  `craneman` and `zawad20`, which is why `zawad20` is excluded; the import fails on the unique index if
  another duplicate appears in a newer dump.
- `LEGACY_EXCLUDE_USERS` (default `zawad20`, carried over from the earlier migration scripts) skips those users
  and everything they own. Currently 25 users use their own email as username; none uses another user's email.
  Registration must keep it that way (reject a username equal to someone else's email).
