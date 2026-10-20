// Dev helper: create (or reset the password of) a user and optionally grant a role.
//   npm run user:create -- <username> <password> [role]
import { loadConfig } from '../config.ts';
import { createPool } from '../db.ts';
import { hashPassword } from '../auth/password.ts';

const [username, password, role] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: npm run user:create -- <username> <password> [role]');
  process.exit(2);
}

const pool = createPool(loadConfig().DATABASE_URL);
try {
  const { rows: [user] } = await pool.query<{ id: string }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [username, await hashPassword(password)],
  );
  if (role) {
    const { rowCount } = await pool.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2 ON CONFLICT DO NOTHING`,
      [user!.id, role]);
    if (rowCount === 0) console.warn(`Role "${role}" not found or already granted.`);
  }
  console.log(`User ${username} ready${role ? ` with role ${role}` : ''}.`);
} finally {
  await pool.end();
}
