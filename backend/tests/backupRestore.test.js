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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// gleiche Auflösung wie routes/backup.js (backend/routes/../../backups)
const backupDir = path.join(__dirname, '../../backups');
const AUTH_TABLES = ['users', 'user_recovery_codes', 'sessions', 'auth_tokens', 'rate_limits', 'audit_log'];

describe.skipIf(!hasDb)('Backup/Restore und Auth-Daten', () => {
  const app = createApp();
  let admin;
  const createdFiles = [];

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetAuthTables();
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

  async function createZipBackup() {
    const res = await request(app).post('/api/backup/create-zip').set('Cookie', admin.cookie).set(ORIGIN);
    expect(res.status).toBe(200);
    createdFiles.push(res.body.filename);
    return res.body.filename;
  }

  // Fixture: echtes ZIP-Backup der Test-DB, dessen data.migrations auf 001-004 gekürzt wird
  // (simuliert ein altes Backup; weniger brüchig als handgebautes Schema).
  async function oldBackupZip() {
    const filename = await createZipBackup();
    const zip = new AdmZip(path.join(backupDir, filename));
    const backup = JSON.parse(zip.getEntry('database.json').getData().toString('utf8'));
    backup.data.migrations = backup.data.migrations.filter((m) => /^00[1-4]/.test(m.name));
    expect(backup.data.migrations.length).toBeGreaterThan(0);
    zip.updateFile('database.json', Buffer.from(JSON.stringify(backup)));
    return { zipBuffer: zip.toBuffer(), backup };
  }

  async function migrationNames() {
    const { rows } = await pool.query('SELECT name FROM migrations');
    return rows.map((r) => r.name);
  }

  async function expectAuthIntact() {
    const names = await migrationNames();
    expect(names.some((n) => n.startsWith('005_plan_usage'))).toBe(true);
    expect(names.some((n) => n.startsWith('006_auth'))).toBe(true);
    const me = await request(app).get('/api/auth/me').set('Cookie', admin.cookie);
    expect(me.status).toBe(200);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [admin.user.id]);
    expect(rows[0].n).toBe(1);
  }

  it('Backup enthält keine Auth-Tabellen', async () => {
    const jsonRes = await request(app).post('/api/backup/create').set('Cookie', admin.cookie).set(ORIGIN);
    expect(jsonRes.status).toBe(200);
    createdFiles.push(jsonRes.body.filename);
    const json = JSON.parse(await fs.readFile(path.join(backupDir, jsonRes.body.filename), 'utf8'));
    const zipName = await createZipBackup();
    const zipData = JSON.parse(new AdmZip(path.join(backupDir, zipName)).getEntry('database.json').getData().toString('utf8'));
    for (const data of [json.data, zipData.data]) {
      for (const t of AUTH_TABLES) expect(Object.keys(data)).not.toContain(t);
    }
  });

  it('ZIP-Restore lässt migrations, Nutzer und Sessions unangetastet', async () => {
    const { zipBuffer } = await oldBackupZip();
    const res = await request(app)
      .post('/api/backup/restore-zip')
      .set('Cookie', admin.cookie)
      .set(ORIGIN)
      .attach('backupFile', zipBuffer, 'backup.zip');
    expect(res.status).toBe(200);
    await expectAuthIntact();
    const rows = await waitForAudit('POST /api/backup/restore-zip');
    expect(rows.length).toBeGreaterThan(0);
    const restored = await waitForAudit('backup.restored');
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ entity_type: 'backup', entity_id: 'backup.zip', details: { format: 'zip' } });
  });

  it('JSON-Restore lässt migrations, Nutzer und Sessions unangetastet', async () => {
    const { backup } = await oldBackupZip();
    const res = await request(app)
      .post('/api/backup/restore')
      .set('Cookie', admin.cookie)
      .set(ORIGIN)
      .send({ backupData: backup });
    expect(res.status).toBe(200);
    await expectAuthIntact();
    const rows = await waitForAudit('POST /api/backup/restore');
    expect(rows.length).toBeGreaterThan(0);
    const restored = await waitForAudit('backup.restored');
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ entity_type: 'backup', entity_id: backup.timestamp, details: { format: 'json' } });
  });

  it('Downloads werden auditiert, 404 nicht', async () => {
    const zipName = await createZipBackup();
    const ok = await request(app).get(`/api/backup/download-zip/${zipName}`).set('Cookie', admin.cookie);
    expect(ok.status).toBe(200);
    let rows = await waitForAudit('backup.downloaded');
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_type).toBe('backup');
    expect(rows[0].entity_id).toBe(zipName);

    const jsonRes = await request(app).post('/api/backup/create').set('Cookie', admin.cookie).set(ORIGIN);
    createdFiles.push(jsonRes.body.filename);
    const okJson = await request(app).get(`/api/backup/download/${jsonRes.body.filename}`).set('Cookie', admin.cookie);
    expect(okJson.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    rows = await waitForAudit('backup.downloaded');
    expect(rows.map((r) => r.entity_id).sort()).toEqual([zipName, jsonRes.body.filename].sort());

    const before = rows.length;
    const missing = await request(app).get('/api/backup/download-zip/vollbackup_2000-01-01T00-00-00-000Z.zip').set('Cookie', admin.cookie);
    expect(missing.status).toBe(404);
    await new Promise((r) => setTimeout(r, 100));
    expect((await waitForAudit('backup.downloaded')).length).toBe(before);
  });
});
