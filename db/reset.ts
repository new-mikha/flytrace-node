// DEV ONLY: drops and recreates the database named in DATABASE_URL, then applies all migrations.
// Refuses unless the database name contains "_dev", so it cannot be pointed at production by accident.
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../server/src/config.ts';
import { createPool, databaseName } from '../server/src/db.ts';
import { runMigrations } from './migrate.ts';

const config = loadConfig();
const dbName = databaseName(config.DATABASE_URL);
if (!dbName.includes('_dev')) {
  console.error(`Refusing to reset "${dbName}": the database name must contain "_dev".`);
  process.exit(1);
}

const adminUrl = new URL(config.DATABASE_URL);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const quoted = `"${dbName.replace(/"/g, '""')}"`;
  await admin.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${quoted}`);
  console.log(`Recreated database ${dbName}.`);
} finally {
  await admin.end();
}

const pool = createPool(config.DATABASE_URL);
try {
  const ran = await runMigrations(pool);
  console.log(`Applied: ${ran.join(', ')}`);
} finally {
  await pool.end();
}
void fileURLToPath;
