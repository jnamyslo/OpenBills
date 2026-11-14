import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database.js';
import logger from '../utils/logger.js';
import { BACKUP_TABLES } from '../utils/backupTables.js';
import { createUser } from '../auth/users.js';
import { hashPassword } from '../auth/password.js';
import { DEMO_EMAIL, DEMO_PASSWORD, isDemoMode, nextResetAt } from './index.js';
import { seedDemoData } from './seed.js';

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
 * Setzt die Demo-Instanz zurück: alles leeren, Demo-User + Demo-Daten anlegen, Marker setzen.
 * Alles in einer Transaktion; Backups werden erst nach erfolgreichem Commit gelöscht.
 */
export async function resetDemo({ now = new Date(), backupDir = DEFAULT_BACKUP_DIR, seed = seedDemoData } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE demo_marker IN EXCLUSIVE MODE');
    await assertDemoDatabase(client);
    const tables = [...BACKUP_TABLES, 'usage_counters', ...AUTH_TABLES].map((t) => client.escapeIdentifier(t));
    await client.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    await createUser(client, { email: DEMO_EMAIL, name: 'Demo', passwordHash: await hashPassword(DEMO_PASSWORD), role: 'admin' });
    await seed(client, now);
    await client.query('INSERT INTO demo_marker DEFAULT VALUES ON CONFLICT DO NOTHING');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await clearBackupDir(backupDir);
  logger.info('Demo zurückgesetzt', { nextResetAt: nextResetAt(now).toISOString() });
}

const RETRY_DELAY_MS = 60 * 1000;

/**
 * Plant den nächsten Reset (volle Stunde, durch 3 teilbar) und danach immer wieder.
 * Schlägt ein Reset fehl (z. B. Deadlock mit einem Besucher-Request), folgt nach einer Minute ein neuer Versuch.
 */
export function scheduleDemoResets({ reset = resetDemo, delayMs } = {}) {
  if (!isDemoMode()) return;
  const delay = delayMs ?? Math.max(nextResetAt(new Date()).getTime() - Date.now(), 1000);
  setTimeout(async () => {
    try {
      await reset();
      scheduleDemoResets({ reset });
    } catch (error) {
      logger.error('Demo-Reset fehlgeschlagen, neuer Versuch in 1 Minute', { error: error.message });
      scheduleDemoResets({ reset, delayMs: RETRY_DELAY_MS });
    }
  }, delay);
}
