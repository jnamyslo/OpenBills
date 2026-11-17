import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasDb, migrateTestDb } from './helpers/db.js';

describe.skipIf(!hasDb)('Migration 006_auth', () => {
  let pool;
  let migration006;

  beforeAll(async () => {
    ({ pool } = await import('../database.js'));
    migration006 = await import('../migrations/006_auth.js');
    await migrateTestDb();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('legt alle Auth-Tabellen an', async () => {
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const names = rows.map((r) => r.table_name);
    for (const t of ['users', 'user_recovery_codes', 'sessions', 'auth_tokens', 'rate_limits', 'audit_log']) {
      expect(names).toContain(t);
    }
  });

  it('ist idempotent', async () => {
    const client = await pool.connect();
    try {
      await migration006.up(client);
      await migration006.up(client);
    } finally {
      client.release();
    }
  });

  it('audit_log verweigert UPDATE und DELETE junger Einträge', async () => {
    const { rows } = await pool.query("INSERT INTO audit_log (action, actor_label) VALUES ('test.young', 'x') RETURNING id");
    const id = rows[0].id;
    await expect(pool.query("UPDATE audit_log SET action = 'y' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_log WHERE id = $1', [id])).rejects.toThrow(/append-only/);
  });

  it('audit_log erlaubt DELETE alter Einträge', async () => {
    const { rows } = await pool.query("INSERT INTO audit_log (at, action, actor_label) VALUES (now() - interval '91 days', 'test.old', 'x') RETURNING id");
    const res = await pool.query('DELETE FROM audit_log WHERE id = $1', [rows[0].id]);
    expect(res.rowCount).toBe(1);
  });
});
