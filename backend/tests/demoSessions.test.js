import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';
import { BACKUP_TABLES } from '../utils/backupTables.js';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../demo/index.js';
import { resetDemo } from '../demo/reset.js';
import { cleanupDemoSchemas, MAX_DEMO_SESSIONS, TEMPLATE_SCHEMA } from '../demo/sessionSchema.js';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { hashToken } from '../auth/crypto.js';

const NEW_CUSTOMER = { name: 'Besucher GmbH', address: 'Str. 1', city: 'Berlin', postalCode: '10115', country: 'Deutschland' };

const count = async (sql, params = []) => Number((await pool.query(sql, params)).rows[0].n);

async function demoSchemas() {
  const { rows } = await pool.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'demo\\_s\\_%' ORDER BY nspname`);
  return rows.map((r) => r.nspname);
}

function schemaOf(cookie) {
  const token = cookie.split('=')[1];
  return `demo_s_${hashToken(token).slice(0, 32)}`;
}

async function dropAllDemoSchemas() {
  for (const s of [...(await demoSchemas()), TEMPLATE_SCHEMA]) {
    await pool.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
  }
}

describe.skipIf(!hasDb)('Demo: eigene Daten je Sitzung', () => {
  const app = createApp();

  async function login() {
    const res = await request(app).post('/api/auth/login').set(ORIGIN).send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'].find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];
  }

  const customerNames = async (cookie) => {
    const res = await request(app).get('/api/customers').set('Cookie', cookie);
    expect(res.status).toBe(200);
    return res.body.map((c) => c.name);
  };

  beforeAll(migrateTestDb);
  beforeEach(async () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    await dropAllDemoSchemas();
    await pool.query(`TRUNCATE ${BACKUP_TABLES.join(', ')}, usage_counters, demo_marker RESTART IDENTITY CASCADE`);
    await resetAuthTables();
    await resetDemo({ backupDir: await mkdtemp(join(tmpdir(), 'demo-backups-')) });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await dropAllDemoSchemas();
    await pool.query(`TRUNCATE ${BACKUP_TABLES.join(', ')}, usage_counters, demo_marker RESTART IDENTITY CASCADE`);
    await resetAuthTables();
    await pool.end();
  });

  it('Reset: Demo-Daten nur in der Vorlage, public bleibt leer', async () => {
    expect(await count(`SELECT COUNT(*) AS n FROM ${TEMPLATE_SCHEMA}.customers`)).toBeGreaterThanOrEqual(8);
    expect(await count(`SELECT COUNT(*) AS n FROM ${TEMPLATE_SCHEMA}.invoices`)).toBeGreaterThanOrEqual(15);
    expect(await count('SELECT COUNT(*) AS n FROM public.customers')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM public.invoices')).toBe(0);
  });

  it('Änderungen sieht nur die eigene Sitzung; Vorlage und public bleiben unverändert', async () => {
    const a = await login();
    const b = await login();
    const templateCustomers = await count(`SELECT COUNT(*) AS n FROM ${TEMPLATE_SCHEMA}.customers`);

    const created = await request(app).post('/api/customers').set(ORIGIN).set('Cookie', a).send(NEW_CUSTOMER);
    expect(created.status).toBe(201);

    expect(await customerNames(a)).toContain('Besucher GmbH');
    expect(await customerNames(b)).not.toContain('Besucher GmbH');
    expect((await customerNames(b)).length).toBe(templateCustomers);
    expect(await count(`SELECT COUNT(*) AS n FROM ${TEMPLATE_SCHEMA}.customers`)).toBe(templateCustomers);
    expect(await count('SELECT COUNT(*) AS n FROM public.customers')).toBe(0);
  });

  it('IDs kommen aus eigenen Sequenzen, Fremdschlüssel zeigen auf die Kopie', async () => {
    const a = await login();
    const created = await request(app).post('/api/customers').set(ORIGIN).set('Cookie', a).send(NEW_CUSTOMER);
    expect(created.status).toBe(201);
    const schema = schemaOf(a);
    const { rows: [fk] } = await pool.query(
      `SELECT confrelid::regclass::text AS target FROM pg_constraint
        WHERE contype = 'f' AND conrelid = $1::regclass AND confrelid::regclass::text LIKE '%customers'`,
      [`${schema}.invoices`]
    );
    expect(fk.target).toBe(`${schema}.customers`);
    const { rows: defaults } = await pool.query(
      `SELECT column_default FROM information_schema.columns WHERE table_schema = $1 AND column_default LIKE 'nextval%'`,
      [schema]
    );
    expect(defaults.length).toBeGreaterThan(0);
    for (const { column_default } of defaults) expect(column_default).toContain(schema);
  });

  it('Audit-Log je Sitzung', async () => {
    const a = await login();
    const b = await login();
    await customerNames(b);
    await request(app).post('/api/customers').set(ORIGIN).set('Cookie', a).send(NEW_CUSTOMER);
    const ownEntries = async (cookie) => {
      for (let i = 0; i < 40; i++) {
        const n = await count(`SELECT COUNT(*) AS n FROM ${schemaOf(cookie)}.audit_log WHERE action = 'POST /api/customers'`);
        if (n > 0) return n;
        await new Promise((r) => setTimeout(r, 25));
      }
      return 0;
    };
    expect(await ownEntries(a)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM ${schemaOf(b)}.audit_log`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM public.audit_log WHERE action = 'POST /api/customers'`)).toBe(0);
  });

  it('Logout löscht die Sitzungsdaten, neuer Login startet frisch', async () => {
    const a = await login();
    await request(app).post('/api/customers').set(ORIGIN).set('Cookie', a).send(NEW_CUSTOMER);
    expect(await demoSchemas()).toEqual([schemaOf(a)]);

    const out = await request(app).post('/api/auth/logout').set(ORIGIN).set('Cookie', a);
    expect(out.status).toBe(204);
    expect(await demoSchemas()).toEqual([]);

    const c = await login();
    expect(await customerNames(c)).not.toContain('Besucher GmbH');
  });

  it('Cleanup löscht Daten abgelaufener Sitzungen', async () => {
    const a = await login();
    const b = await login();
    await customerNames(a);
    await customerNames(b);
    await pool.query('DELETE FROM sessions WHERE id_hash = $1', [hashToken(a.split('=')[1])]);
    expect(await cleanupDemoSchemas()).toBe(1);
    expect(await demoSchemas()).toEqual([schemaOf(b)]);
  });

  it('volle Demo: älteste Sitzung wird beendet', async () => {
    const { rows: [user] } = await pool.query('SELECT id FROM users WHERE email = $1', [DEMO_EMAIL]);
    // MAX_DEMO_SESSIONS Sitzungen mit (leeren) Schemas vortäuschen, älteste zuerst
    for (let i = 0; i < MAX_DEMO_SESSIONS; i++) {
      const hash = hashToken(`fake-${i}`);
      await pool.query(
        `INSERT INTO sessions (id_hash, user_id, expires_at, last_seen_at) VALUES ($1, $2, now() + interval '1 day', now() - ($3 * interval '1 second'))`,
        [hash, user.id, MAX_DEMO_SESSIONS - i]
      );
      await pool.query(`CREATE SCHEMA demo_s_${hash.slice(0, 32)}`);
    }
    const a = await login();
    await customerNames(a);
    const schemas = await demoSchemas();
    expect(schemas).toHaveLength(MAX_DEMO_SESSIONS);
    expect(schemas).toContain(schemaOf(a));
    expect(schemas).not.toContain(`demo_s_${hashToken('fake-0').slice(0, 32)}`);
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE id_hash = $1', [hashToken('fake-0')])).toBe(0);
  });

  it('Backups in der Demo gesperrt', async () => {
    const a = await login();
    const res = await request(app).get('/api/backup/list-all').set('Cookie', a);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DEMO_DISABLED');
  });
});
