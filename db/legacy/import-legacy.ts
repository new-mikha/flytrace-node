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

// Imports a CSV dump of the original Flytrace (MSSQL) database into the new schema.
//
//   npm run db:import-legacy -- db/legacy/dump/20251101_181031
//
// Everything runs in one transaction: create staging tables, COPY the CSVs in, transform into the
// real tables, run verify.sql. Any failed check rolls the whole thing back. On success the staging
// tables are dropped. Usernames listed in LEGACY_EXCLUDE_USERS (and everything they own) are
// skipped.
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { from as copyFrom } from 'pg-copy-streams';
import { legacyExcludedUsers, loadConfig } from '../../server/src/config.ts';
import { type Client, createPool, withTransaction } from '../../server/src/db.ts';

const here = dirname(fileURLToPath(import.meta.url));

// CSV file name (as produced by dump-all-tables.sh) -> staging table.
const TABLES = [
  'aspnet_Applications',
  'aspnet_Membership',
  'aspnet_Roles',
  'aspnet_SchemaVersions',
  'aspnet_Users',
  'aspnet_UsersInRoles',
  'Event',
  'Group',
  'GroupTracker',
  'Task',
  'UserProfile',
  'Waypoint',
] as const;

interface Check {
  check_name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

async function copyCsv(client: Client, table: string, csvPath: string): Promise<number> {
  const stream = client.query(
    copyFrom(`COPY orig_${table} FROM STDIN WITH (FORMAT csv, HEADER true)`),
  );
  await pipeline(createReadStream(csvPath), stream);
  return stream.rowCount ?? 0;
}

/**
 * Lists the rows whose name was changed because the old data had duplicates (see transform.sql).
 */
async function reportRenames(client: Client): Promise<void> {
  const { rows } = await client.query<{
    entity: string;
    id: number;
    context: string;
    old_name: string;
    new_name: string;
  }>('SELECT entity, id, context, old_name, new_name FROM legacy_renames ORDER BY entity, id');
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.entity, (counts.get(r.entity) ?? 0) + 1);
  const summary = [...counts]
    .map(([entity, n]) => `${n} ${entity}${n === 1 ? '' : 's'}`)
    .join(', ');
  console.log(
    `\nRenamed ${rows.length} duplicate name${rows.length === 1 ? '' : 's'}${
      summary ? ` (${summary})` : ''
    }:`,
  );
  for (const r of rows)
    console.log(
      `  ${r.entity.padEnd(8)} ${String(r.id).padStart(6)} (${r.context}): ${JSON.stringify(
        r.old_name,
      )} -> ${JSON.stringify(r.new_name)}`,
    );
}

async function main(): Promise<void> {
  const dumpArg = process.argv[2];
  if (!dumpArg) {
    console.error('Usage: npm run db:import-legacy -- <path-to-dump-dir>');
    process.exit(2);
  }
  const dumpDir = resolve(dumpArg);
  for (const t of TABLES) await access(join(dumpDir, `${t}.csv`));

  const config = loadConfig();
  const excluded = legacyExcludedUsers(config);
  const pool = createPool(config.DATABASE_URL);
  try {
    const {
      rows: [existing],
    } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
    if (Number(existing?.n) > 0) {
      console.error(
        `Target database already has ${existing?.n} users; import only into an empty schema (see npm
          run db:reset).`,
      );
      process.exit(1);
    }

    const checks = await withTransaction(pool, async (client) => {
      await client.query(await readFile(join(here, 'staging.sql'), 'utf8'));
      for (const name of excluded)
        await client.query(
          'INSERT INTO legacy_exclude (username) VALUES ($1) ON CONFLICT DO NOTHING',
          [name],
        );

      for (const t of TABLES) {
        const n = await copyCsv(client, t, join(dumpDir, `${t}.csv`));
        console.log(`staged ${t.padEnd(22)} ${String(n).padStart(6)} rows`);
      }
      await client.query(await readFile(join(here, 'transform.sql'), 'utf8'));
      await reportRenames(client);
      const { rows } = await client.query<Check>(await readFile(join(here, 'verify.sql'), 'utf8'));

      console.log('\nVerification:');
      for (const c of rows)
        console.log(
          `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.check_name.padEnd(44)} expected ${String(
            c.expected,
          ).padStart(6)}  actual ${String(c.actual).padStart(6)}`,
        );

      if (rows.some((c) => !c.ok)) throw new Error('Verification failed; transaction rolled back.');

      for (const t of TABLES) await client.query(`DROP TABLE orig_${t}`);
      await client.query('DROP TABLE legacy_exclude');
      return rows;
    });

    console.log(
      `\nImported ${checks.find((c) => c.check_name === 'users')?.actual} users from ${dumpDir}.`,
    );
  } finally {
    await pool.end();
  }
}

await main();
