import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database.js';
import logger from '../utils/logger.js';
import { BACKUP_TABLES } from '../utils/backupTables.js';
import { createUser } from '../auth/users.js';
import { hashPassword } from '../auth/password.js';
import { DEMO_EMAIL, DEMO_PASSWORD } from './index.js';
import { seedDemoData } from './seed.js';
import { buildTemplate, dropOrphanSchemas, lockDemoSchemas } from './sessionSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Gleicher Ordner wie routes/backup.js
const DEFAULT_BACKUP_DIR = path.join(__dirname, '../../backups');

const AUTH_TABLES = ['users', 'user_recovery_codes', 'sessions', 'auth_tokens', 'rate_limits', 'audit_log'];

export class DemoRefusedError extends Error {
  constructor() {
    super('Datenbank enthält echte Daten – Demo-Modus verweigert');
    this.name = 'DemoRefusedError';
  }
}

/** Schutz echter Daten: nur eine markierte oder leere DB darf geleert werden. */
export async function assertDemoDatabase(client) {
  const marker = await client.query('SELECT 1 FROM demo_marker LIMIT 1');
  if (marker.rows.length > 0) return;
  const { rows: [r] } = await client.query(`
    SELECT EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM invoices) OR EXISTS (SELECT 1 FROM customers) AS has_data
  `);
  if (r.has_data) throw new DemoRefusedError();
}

async function clearBackupDir(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(entries.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true })));
}

/**
 * Setzt die Demo-Instanz zurück: alles leeren (inkl. aller Sitzungen und ihrer Daten), Demo-User anlegen,
 * Demo-Vorlage neu aufbauen, Marker setzen. Die App-Tabellen in public bleiben leer (siehe sessionSchema.js).
 * Alles in einer Transaktion; Backups werden erst nach erfolgreichem Commit gelöscht.
 */
export async function resetDemo({ now = new Date(), backupDir = DEFAULT_BACKUP_DIR, seed = seedDemoData } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE demo_marker IN EXCLUSIVE MODE');
    await lockDemoSchemas(client);
    await assertDemoDatabase(client);
    const tables = [...BACKUP_TABLES, 'usage_counters', ...AUTH_TABLES].map((t) => client.escapeIdentifier(t));
    await client.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    await createUser(client, { email: DEMO_EMAIL, name: 'Demo', passwordHash: await hashPassword(DEMO_PASSWORD), role: 'admin' });
    await client.query('INSERT INTO demo_marker DEFAULT VALUES ON CONFLICT DO NOTHING');
    await dropOrphanSchemas(client);
    await buildTemplate(client, { now, seed });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await clearBackupDir(backupDir);
  logger.info('Demo zurückgesetzt');
}
