import { pool } from '../../database.js';
import { runMigrations } from '../../migrations/index.js';

export const hasDb = Boolean(process.env.DB_HOST);

export async function migrateTestDb() {
  const client = await pool.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
  }
}

export async function resetAuthTables() {
  await pool.query('TRUNCATE users, user_recovery_codes, sessions, auth_tokens, rate_limits RESTART IDENTITY CASCADE');
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only');
    try {
      await client.query('DELETE FROM audit_log');
    } finally {
      await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only');
    }
  } finally {
    client.release();
  }
}
