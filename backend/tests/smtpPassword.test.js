import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb } from './helpers/db.js';
import { encryptSmtpPass, decryptSmtpPass } from '../utils/smtpPassword.js';
import * as migration008 from '../migrations/008_encrypt_smtp_pass.js';

describe('smtpPassword', () => {
  it('verschlüsselt und entschlüsselt', () => {
    const enc = encryptSmtpPass('geheim');
    expect(enc).not.toContain('geheim');
    expect(decryptSmtpPass(enc)).toBe('geheim');
  });

  it('lässt leere Werte leer', () => {
    for (const v of [null, undefined, '']) {
      expect(encryptSmtpPass(v)).toBe(v);
      expect(decryptSmtpPass(v)).toBe(v);
    }
  });
});

describe.skipIf(!hasDb)('Migration 008_encrypt_smtp_pass', () => {
  beforeAll(async () => {
    await migrateTestDb();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('verschlüsselt vorhandene Klartext-Passwörter einmalig (idempotent)', async () => {
    await pool.query('DELETE FROM smtp_settings');
    await pool.query(`INSERT INTO smtp_settings (id, smtp_pass) VALUES (1, 'klartext-passwort')`);
    const client = await pool.connect();
    try {
      await migration008.up(client);
      const { rows: first } = await client.query('SELECT smtp_pass FROM smtp_settings');
      expect(decryptSmtpPass(first[0].smtp_pass)).toBe('klartext-passwort');
      await migration008.up(client);
      const { rows: second } = await client.query('SELECT smtp_pass FROM smtp_settings');
      expect(second[0].smtp_pass).toBe(first[0].smtp_pass);
    } finally {
      client.release();
      await pool.query('DELETE FROM smtp_settings');
    }
  });
});
