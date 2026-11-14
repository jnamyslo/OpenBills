import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { BACKUP_TABLES } from '../utils/backupTables.js';
import { verifyPassword } from '../auth/password.js';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../demo/index.js';
import { seedDemoData } from '../demo/seed.js';
import { resetDemo, assertDemoDatabase, DemoRefusedError } from '../demo/reset.js';

async function wipeAll() {
  await pool.query(`TRUNCATE ${BACKUP_TABLES.join(', ')}, usage_counters, demo_marker RESTART IDENTITY CASCADE`);
  await resetAuthTables();
}

const count = async (sql, params = []) => Number((await pool.query(sql, params)).rows[0].n);

describe.skipIf(!hasDb)('Demo-Reset', () => {
  let backupDir;

  beforeAll(migrateTestDb);
  beforeEach(async () => {
    await wipeAll();
    backupDir = await mkdtemp(join(tmpdir(), 'demo-backups-'));
    await writeFile(join(backupDir, 'vollbackup_2026-01-01T00-00-00Z.zip'), 'x');
  });
  afterAll(async () => {
    await wipeAll();
    await pool.end();
  });

  it('leere DB: Reset legt Marker, Demo-User und Seed an und leert Backups', async () => {
    await resetDemo({ backupDir });
    expect(await count('SELECT COUNT(*) AS n FROM demo_marker')).toBe(1);
    const { rows } = await pool.query('SELECT * FROM users');
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(DEMO_EMAIL);
    expect(rows[0].role).toBe('admin');
    expect(rows[0].is_operator).toBe(false);
    expect(await verifyPassword(rows[0].password_hash, DEMO_PASSWORD)).toBe(true);
    expect(await readdir(backupDir)).toEqual([]);
  });

  it('echte Daten ohne Marker: verweigert, nichts gelöscht', async () => {
    await pool.query(`INSERT INTO customers (customer_number, name, address, city, postal_code, country)
                      VALUES ('0001', 'Echte Kunde GmbH', 'Str. 1', 'Berlin', '10115', 'Deutschland')`);
    await expect(resetDemo({ backupDir })).rejects.toBeInstanceOf(DemoRefusedError);
    await expect(resetDemo({ backupDir })).rejects.toThrow('Datenbank enthält echte Daten – Demo-Modus verweigert');
    expect(await count('SELECT COUNT(*) AS n FROM customers')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM demo_marker')).toBe(0);
    expect(await readdir(backupDir)).toHaveLength(1);
  });

  it('nur ein Benutzer ohne Marker: ebenfalls verweigert', async () => {
    await pool.query(`INSERT INTO users (email, name, password_hash, role) VALUES ('chef@firma.de', 'Chef', 'x', 'admin')`);
    const client = await pool.connect();
    try {
      await expect(assertDemoDatabase(client)).rejects.toBeInstanceOf(DemoRefusedError);
    } finally {
      client.release();
    }
  });

  it('mit Marker: Besucherdaten werden ersetzt', async () => {
    await resetDemo({ backupDir });
    await pool.query(`INSERT INTO customers (customer_number, name, address, city, postal_code, country)
                      VALUES ('9999', 'Besucher GmbH', 'Str. 1', 'Berlin', '10115', 'Deutschland')`);
    await pool.query(`INSERT INTO sessions (id_hash, user_id, expires_at)
                      SELECT 'h', id, now() + interval '1 day' FROM users LIMIT 1`);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(1);
    await resetDemo({ backupDir });
    expect(await count(`SELECT COUNT(*) AS n FROM customers WHERE name = 'Besucher GmbH'`)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(1);
  });

  it('Seed-Inhalt ist vollständig', async () => {
    const now = new Date();
    await resetDemo({ now, backupDir });
    expect(await count('SELECT COUNT(*) AS n FROM customers')).toBeGreaterThanOrEqual(8);
    for (const status of ['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x']) {
      expect(await count('SELECT COUNT(*) AS n FROM invoices WHERE status = $1', [status]), status).toBeGreaterThanOrEqual(1);
    }
    expect(await count(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'overdue' AND due_date < CURRENT_DATE`)).toBeGreaterThanOrEqual(1);
    expect(await count('SELECT COUNT(*) AS n FROM invoices')).toBeGreaterThanOrEqual(15);
    expect(await count('SELECT COUNT(*) AS n FROM invoice_items')).toBeGreaterThanOrEqual(15);
    expect(await count('SELECT COUNT(*) AS n FROM quotes')).toBeGreaterThanOrEqual(5);
    expect(await count('SELECT COUNT(DISTINCT status) AS n FROM quotes')).toBeGreaterThanOrEqual(3);
    expect(await count('SELECT COUNT(*) AS n FROM quotes WHERE converted_to_invoice_id IS NOT NULL')).toBeGreaterThanOrEqual(1);
    expect(await count('SELECT COUNT(*) AS n FROM job_entries')).toBeGreaterThanOrEqual(6);
    expect(await count('SELECT COUNT(*) AS n FROM job_time_entries')).toBeGreaterThanOrEqual(4);
    expect(await count('SELECT COUNT(*) AS n FROM hourly_rates')).toBeGreaterThanOrEqual(3);
    expect(await count('SELECT COUNT(*) AS n FROM material_templates')).toBeGreaterThanOrEqual(6);
    expect(await count('SELECT COUNT(*) AS n FROM customer_specific_hourly_rates')).toBeGreaterThanOrEqual(1);
    const { rows: [company] } = await pool.query('SELECT * FROM company');
    expect(company.reminders_enabled && company.job_tracking_enabled && company.quotes_enabled && company.reporting_enabled).toBe(true);
    // Nummern eindeutig und im RE-YYYY-NNN-Format
    const { rows: numbers } = await pool.query('SELECT invoice_number FROM invoices');
    for (const { invoice_number } of numbers) expect(invoice_number).toMatch(/^RE-\d{4}-\d{3}$/);
  });

  it('Datumswerte relativ zu now', async () => {
    const now = new Date(2027, 2, 10, 12, 0);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedDemoData(client, now);
      const { rows: [r] } = await client.query('SELECT MIN(issue_date) AS min, MAX(issue_date) AS max FROM invoices');
      await client.query('ROLLBACK');
      expect(new Date(r.max).getTime()).toBeLessThanOrEqual(now.getTime());
      const sevenMonthsAgo = new Date(now);
      sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
      expect(new Date(r.min).getTime()).toBeGreaterThanOrEqual(sevenMonthsAgo.getTime());
    } finally {
      client.release();
    }
  });

  it('Fehler im Seed: Rollback, Marker und Daten bleiben', async () => {
    await resetDemo({ backupDir });
    const before = await count('SELECT COUNT(*) AS n FROM invoices');
    await pool.query(`INSERT INTO customers (customer_number, name, address, city, postal_code, country)
                      VALUES ('9999', 'Besucher GmbH', 'Str. 1', 'Berlin', '10115', 'Deutschland')`);
    const failingSeed = async () => { throw new Error('kaputt'); };
    await expect(resetDemo({ backupDir, seed: failingSeed })).rejects.toThrow('kaputt');
    expect(await count('SELECT COUNT(*) AS n FROM demo_marker')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM invoices')).toBe(before);
    expect(await count(`SELECT COUNT(*) AS n FROM customers WHERE name = 'Besucher GmbH'`)).toBe(1);
  });
});
