import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { createUser, findUserByEmail, OPERATOR_EMAIL } from '../auth/users.js';
import { verifyPassword } from '../auth/password.js';
import { createSession, getSession } from '../auth/sessions.js';
import { hashToken } from '../auth/crypto.js';
import { resetOperator } from '../scripts/operator.js';
import { createOnboardingLink } from '../scripts/onboarding.js';
import { parseArgs } from '../scripts/archiveExport.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runScript = (args) => promisify(execFile)('node', ['scripts/archiveExport.js', ...args], {
  cwd: backendDir,
  encoding: 'buffer',
  maxBuffer: 50 * 1024 * 1024,
  env: { ...process.env, LOG_LEVEL: 'DEBUG' },
});

describe('archiveExport parseArgs', () => {
  it('liest --out/--from/--to und lehnt Unbekanntes ab', () => {
    expect(parseArgs(['--out', '/tmp/a.zip', '--from', '2026-01-01', '--to', '2026-12-31']))
      .toEqual({ out: '/tmp/a.zip', from: '2026-01-01', to: '2026-12-31' });
    expect(() => parseArgs(['--from', '01.01.2026'])).toThrow(/Ungültiges Datum/);
    expect(() => parseArgs(['--foo', 'x'])).toThrow(/Unbekannter/);
    expect(() => parseArgs(['--out'])).toThrow(/unvollständiger/);
  });
});

describe.skipIf(!hasDb)('Betreiber-Skripte (DB)', () => {
  beforeAll(migrateTestDb);
  afterAll(() => pool.end());
  beforeEach(resetAuthTables);

  it('resetOperator legt Operator an und setzt Passwort neu', async () => {
    const first = await resetOperator();
    expect(first.email).toBe(OPERATOR_EMAIL);
    expect(first.password).toHaveLength(24);
    const op = await findUserByEmail(OPERATOR_EMAIL);
    expect(op.is_operator).toBe(true);
    expect(op.role).toBe('admin');
    expect(op.name).toBe('Support-Zugang');

    const token = await createSession(op.id);
    await pool.query(
      `UPDATE users SET totp_secret_enc='x', totp_enabled_at=now(), failed_login_count=5, locked_until=now()+interval '1 hour', is_active=false WHERE id=$1`,
      [op.id]
    );
    await pool.query(`INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, 'h')`, [op.id]);

    const second = await resetOperator();
    expect(second.password).not.toBe(first.password);
    const { rows } = await pool.query('SELECT * FROM users');
    expect(rows).toHaveLength(1);
    expect(await verifyPassword(rows[0].password_hash, second.password)).toBe(true);
    expect(await verifyPassword(rows[0].password_hash, first.password)).toBe(false);
    expect(rows[0].totp_secret_enc).toBeNull();
    expect(rows[0].totp_enabled_at).toBeNull();
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].failed_login_count).toBe(0);
    expect(rows[0].locked_until).toBeNull();
    expect((await pool.query('SELECT 1 FROM user_recovery_codes')).rowCount).toBe(0);
    expect(await getSession(token)).toBeNull();
    const { rows: log } = await pool.query(`SELECT * FROM audit_log WHERE action='operator.reset'`);
    expect(log).toHaveLength(2);
    expect(log[0].actor_label).toBe('System');
    expect(log[0].entity_type).toBe('users');
  });

  it('resetOperator wandelt keinen normalen Nutzer um', async () => {
    await createUser(pool, { email: OPERATOR_EMAIL, name: 'X', passwordHash: 'x', role: 'user' });
    await expect(resetOperator()).rejects.toThrow(/existiert bereits/);
  });

  it('createOnboardingLink liefert URL und widerruft alten Token', async () => {
    const a = await createOnboardingLink();
    expect(a).toMatch(/^https:\/\/test\.example\/#setup\/[A-Za-z0-9_-]{43}$/);
    const b = await createOnboardingLink();
    expect(b).not.toBe(a);
    const { rows } = await pool.query('SELECT used_at FROM auth_tokens WHERE token_hash=$1', [
      hashToken(a.split('/').pop()),
    ]);
    expect(rows[0].used_at).not.toBeNull();
  });

  it('archiveExport schreibt ein gültiges ZIP nach stdout und meldet fehlende Fassungen auf stderr', async () => {
    await pool.query('TRUNCATE invoices, customers CASCADE');
    const { rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, address, city, postal_code, country, customer_number)
       VALUES ('Kunde', 'Str. 1', 'Berlin', '10115', 'DE', 'K-1') RETURNING id`
    );
    await pool.query(
      `INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status)
       VALUES ('RE-2026-001', $1, 'Kunde', '2026-03-10', '2026-03-24', 100, 19, 119, 'sent')`,
      [customerId]
    );

    // LOG_LEVEL=DEBUG: Logger-Ausgaben dürfen das ZIP auf stdout nicht verunreinigen
    const { stdout, stderr } = await runScript(['--from', '2026-01-01']);
    const zip = new AdmZip(stdout);
    expect(zip.getEntry('LIESMICH.txt')).not.toBeNull();
    expect(zip.getEntry('rechnungsjournal.csv').getData().toString('utf8')).toContain('RE-2026-001');
    expect(stderr.toString('utf8')).toMatch(/1 freigegebene Belege ohne Archivfassung \(1 Rechnungen, 0 Angebote\)/);
    const { rows: log } = await pool.query(`SELECT details FROM audit_log WHERE action = 'archive.exported'`);
    expect(log).toHaveLength(1);
    expect(log[0].details).toMatchObject({ from: '2026-01-01', source: 'script' });
  });

  it('createOnboardingLink wirft mit Kunden-Admin', async () => {
    await createUser(pool, { email: 'a@kunde.de', name: 'A', passwordHash: 'x', role: 'admin' });
    await expect(createOnboardingLink()).rejects.toThrow('Instanz ist bereits eingerichtet (Kunden-Admin vorhanden).');
  });
});
