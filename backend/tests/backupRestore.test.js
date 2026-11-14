import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, waitForAudit, ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';
import { BACKUP_TABLES, EXCLUDED_TABLES } from '../utils/backupTables.js';
import { decryptBackup } from '../utils/backupCrypto.js';
import { decryptSmtpPass } from '../utils/smtpPassword.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// gleiche Auflösung wie routes/backup.js (backend/routes/../../backups)
const backupDir = path.join(__dirname, '../../backups');
const AUTH_TABLES = ['users', 'user_recovery_codes', 'sessions', 'auth_tokens', 'rate_limits', 'audit_log'];
const PASS = 'backup-passwort-123';

describe.skipIf(!hasDb)('Backup/Restore', () => {
  const app = createApp();
  let admin;
  const createdFiles = [];

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetAuthTables();
    await pool.query(`TRUNCATE ${BACKUP_TABLES.join(', ')} CASCADE`);
    admin = await loginAs('admin');
  });

  afterEach(async () => {
    for (const f of createdFiles.splice(0)) {
      await fs.rm(path.join(backupDir, f), { force: true });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createZipBackup(passphrase = PASS) {
    const res = await request(app)
      .post('/api/backup/create-zip')
      .set('Cookie', admin.cookie)
      .set(ORIGIN)
      .send({ passphrase });
    expect(res.status).toBe(200);
    createdFiles.push(res.body.filename);
    return res.body.filename;
  }

  async function readBackup(filename, passphrase = PASS) {
    const zip = new AdmZip(path.join(backupDir, filename));
    const header = JSON.parse(zip.getEntry('encryption.json').getData().toString('utf8'));
    const plain = decryptBackup(header, zip.getEntry('database.json.enc').getData(), passphrase);
    return JSON.parse(plain.toString('utf8'));
  }

  function restore(zipBuffer, passphrase) {
    const req = request(app)
      .post('/api/backup/restore-zip')
      .set('Cookie', admin.cookie)
      .set(ORIGIN)
      .attach('backupFile', zipBuffer, 'backup.zip');
    return passphrase === undefined ? req : req.field('passphrase', passphrase);
  }

  async function insertCustomer(name) {
    await pool.query(
      `INSERT INTO customers (customer_number, name, address, city, postal_code, country)
       VALUES ($1, $2, 'Straße 1', 'Ort', '12345', 'DE')`,
      [`K-${name}`, name]
    );
  }

  async function customerNames() {
    const { rows } = await pool.query('SELECT name FROM customers ORDER BY name');
    return rows.map((r) => r.name);
  }

  async function expectAuthIntact() {
    const { rows: mig } = await pool.query('SELECT name FROM migrations');
    expect(mig.some((m) => m.name.startsWith('006_auth'))).toBe(true);
    const me = await request(app).get('/api/auth/me').set('Cookie', admin.cookie);
    expect(me.status).toBe(200);
  }

  it('ordnet jede Tabelle der DB genau einer Liste zu', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const dbTables = rows.map((r) => r.table_name).sort();
    expect(BACKUP_TABLES.filter((t) => EXCLUDED_TABLES.includes(t))).toEqual([]);
    expect([...BACKUP_TABLES, ...EXCLUDED_TABLES].sort()).toEqual(dbTables);
  });

  it('JSON-Backup-Routen gibt es nicht mehr', async () => {
    for (const [method, url] of [
      ['post', '/api/backup/create'],
      ['get', '/api/backup/list'],
      ['post', '/api/backup/restore'],
      ['get', '/api/backup/download/backup_2000-01-01T00-00-00-000Z.json'],
    ]) {
      const res = await request(app)[method](url).set('Cookie', admin.cookie).set(ORIGIN);
      expect(res.status).toBe(404);
    }
  });

  it('verlangt ein Passwort mit mindestens 12 Zeichen', async () => {
    for (const passphrase of [undefined, '', 'zu-kurz']) {
      const res = await request(app)
        .post('/api/backup/create-zip')
        .set('Cookie', admin.cookie)
        .set(ORIGIN)
        .send(passphrase === undefined ? {} : { passphrase });
      expect(res.status).toBe(400);
    }
  });

  it('verschlüsselt die Daten im ZIP und enthält keine Auth-Tabellen', async () => {
    await insertCustomer('Geheimkunde GmbH');
    const filename = await createZipBackup();
    const raw = await fs.readFile(path.join(backupDir, filename));
    const zip = new AdmZip(raw);
    expect(zip.getEntry('database.json')).toBeNull();
    expect(zip.getEntry('database.json.enc').getData().includes(Buffer.from('Geheimkunde'))).toBe(false);

    const backup = await readBackup(filename);
    expect(backup.data.customers.map((c) => c.name)).toEqual(['Geheimkunde GmbH']);
    expect(Object.keys(backup.data).sort()).toEqual([...BACKUP_TABLES].sort());
    for (const t of AUTH_TABLES) expect(Object.keys(backup.data)).not.toContain(t);
  });

  it('stellt verschlüsseltes Backup mit richtigem Passwort wieder her', async () => {
    await insertCustomer('Alt');
    const filename = await createZipBackup();
    await pool.query('DELETE FROM customers');
    await insertCustomer('Neu');

    const res = await restore(await fs.readFile(path.join(backupDir, filename)), PASS);
    expect(res.status).toBe(200);
    expect(await customerNames()).toEqual(['Alt']);
    await expectAuthIntact();
    const restored = await waitForAudit('backup.restored');
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ entity_type: 'backup', entity_id: 'backup.zip', details: { format: 'zip' } });
  });

  it('lehnt falsches oder fehlendes Passwort ab und lässt Daten unverändert', async () => {
    await insertCustomer('Alt');
    const filename = await createZipBackup();
    await pool.query('DELETE FROM customers');
    await insertCustomer('Neu');
    const zipBuffer = await fs.readFile(path.join(backupDir, filename));

    const wrong = await restore(zipBuffer, 'falsches-passwort-xyz');
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/Passwort/);
    const missing = await restore(zipBuffer);
    expect(missing.status).toBe(400);
    expect(await customerNames()).toEqual(['Neu']);
  });

  it('stellt alte unverschlüsselte ZIP-Backups ohne Passwort wieder her', async () => {
    await insertCustomer('Legacy');
    const backup = await readBackup(await createZipBackup());
    const zip = new AdmZip();
    zip.addFile('database.json', Buffer.from(JSON.stringify({ ...backup, version: '2.0' })));
    zip.addFile('metadata.json', Buffer.from(JSON.stringify({ name: 'OpenBills Vollbackup' })));
    await pool.query('DELETE FROM customers');

    const res = await restore(zip.toBuffer());
    expect(res.status).toBe(200);
    expect(await customerNames()).toEqual(['Legacy']);
  });

  it('setzt Serial-Sequenzen nach dem Restore auf den höchsten Wert', async () => {
    await pool.query('INSERT INTO yearly_invoice_start_numbers (year, start_number) VALUES (2024, 100), (2025, 200)');
    const filename = await createZipBackup();
    // frische Instanz simulieren: Sequenz steht wieder bei 1
    await pool.query('TRUNCATE yearly_invoice_start_numbers RESTART IDENTITY');

    const res = await restore(await fs.readFile(path.join(backupDir, filename)), PASS);
    expect(res.status).toBe(200);

    const created = await request(app)
      .post('/api/yearly-invoice-start-numbers')
      .set('Cookie', admin.cookie)
      .set(ORIGIN)
      .send({ year: 2026, startNumber: 1 });
    expect(created.status).toBeLessThan(300);
  });

  it('sichert das SMTP-Passwort im Klartext im (verschlüsselten) Backup und verschlüsselt es beim Restore neu', async () => {
    const saved = await request(app)
      .post('/api/email-management/smtp-settings')
      .set('Cookie', admin.cookie)
      .set(ORIGIN)
      .send({ smtp_host: 'smtp.example', smtp_port: 587, smtp_user: 'u', smtp_pass: 'smtp-geheim', email_from: 'a@b.de', is_enabled: true });
    expect(saved.status).toBe(200);
    const { rows: before } = await pool.query('SELECT smtp_pass FROM smtp_settings WHERE id = 1');
    expect(before[0].smtp_pass).not.toContain('smtp-geheim');

    const filename = await createZipBackup();
    const backup = await readBackup(filename);
    expect(backup.data.smtp_settings[0].smtp_pass).toBe('smtp-geheim');

    const res = await restore(await fs.readFile(path.join(backupDir, filename)), PASS);
    expect(res.status).toBe(200);
    const { rows: after } = await pool.query('SELECT smtp_pass FROM smtp_settings WHERE id = 1');
    expect(after[0].smtp_pass).not.toContain('smtp-geheim');
    expect(decryptSmtpPass(after[0].smtp_pass)).toBe('smtp-geheim');
  });

  it('listet ZIP-Backups mit Verschlüsselungsstatus und löscht sie', async () => {
    const filename = await createZipBackup();
    const list = await request(app).get('/api/backup/list-all').set('Cookie', admin.cookie);
    expect(list.status).toBe(200);
    expect(list.body.zipBackups.find((b) => b.filename === filename)).toMatchObject({ encrypted: true });

    const del = await request(app).delete(`/api/backup/delete/${filename}`).set('Cookie', admin.cookie).set(ORIGIN);
    expect(del.status).toBe(200);
    await expect(fs.access(path.join(backupDir, filename))).rejects.toThrow();
  });

  it('Downloads werden auditiert, 404 nicht', async () => {
    const zipName = await createZipBackup();
    const ok = await request(app).get(`/api/backup/download-zip/${zipName}`).set('Cookie', admin.cookie);
    expect(ok.status).toBe(200);
    const rows = await waitForAudit('backup.downloaded');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'backup', entity_id: zipName });

    const missing = await request(app).get('/api/backup/download-zip/vollbackup_2000-01-01T00-00-00-000Z.zip').set('Cookie', admin.cookie);
    expect(missing.status).toBe(404);
    await new Promise((r) => setTimeout(r, 100));
    expect(await waitForAudit('backup.downloaded')).toHaveLength(1);
  });
});
