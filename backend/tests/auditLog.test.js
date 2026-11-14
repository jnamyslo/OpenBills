import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { ORIGIN, loginAs } from './helpers/auth.js';

const { createApp } = await import('../app.js');
const app = createApp();

const get = (path, cookie) => request(app).get(path).set(ORIGIN).set('Cookie', cookie);

const insert = (at, over = {}) => pool.query(
  `INSERT INTO audit_log (at, user_id, actor_label, is_operator, action, entity_type, entity_id, ip)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [at, over.userId ?? null, over.actor ?? 'Max', over.op ?? false, over.action ?? 'auth.login',
    over.entityType ?? null, over.entityId ?? null, 'ip' in over ? over.ip : '1.2.3.4'],
);

describe.skipIf(!hasDb)('audit log API', () => {
  beforeAll(migrateTestDb);
  beforeEach(resetAuthTables);
  afterAll(() => pool.end());

  it('is admin only', async () => {
    const user = await loginAs('user');
    expect((await get('/api/audit-log', user.cookie)).status).toBe(403);
  });

  it('returns mapped entries sorted by at DESC', async () => {
    const admin = await loginAs('admin');
    await insert('2026-01-01T10:00:00Z', { action: 'a.old', entityType: 'invoice', entityId: '5' });
    await insert('2026-01-02T10:00:00Z', { action: 'a.new', op: true });
    const res = await get('/api/audit-log', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(50);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBe(2);
    const [first, second] = res.body.entries;
    expect(first.action).toBe('a.new');
    expect(first.isOperator).toBe(true);
    expect(typeof first.id).toBe('number');
    expect(first.at).toBe('2026-01-02T10:00:00.000Z');
    expect(second).toMatchObject({ actorLabel: 'Max', entityType: 'invoice', entityId: '5', ip: '1.2.3.4', isOperator: false });
  });

  it('filters from/to inclusively by day', async () => {
    const admin = await loginAs('admin');
    await pool.query("SET timezone = 'UTC'");
    for (const at of ['2026-03-09T23:59:00Z', '2026-03-10T00:00:00Z', '2026-03-11T23:00:00Z', '2026-03-12T00:00:00Z']) {
      await insert(at, { action: `x.${at}` });
    }
    const res = await get('/api/audit-log?from=2026-03-10&to=2026-03-11', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('filters by action prefix with escaped wildcards', async () => {
    const admin = await loginAs('admin');
    await insert('2026-01-01T10:00:00Z', { action: 'auth.login' });
    await insert('2026-01-01T10:00:01Z', { action: 'auth.logout' });
    await insert('2026-01-01T10:00:02Z', { action: 'invoice.create' });
    await insert('2026-01-01T10:00:03Z', { action: 'authXlogin' });
    expect((await get('/api/audit-log?action=auth.', admin.cookie)).body.total).toBe(2);
    expect((await get('/api/audit-log?action=auth_', admin.cookie)).body.total).toBe(0);
    expect((await get('/api/audit-log?action=%25', admin.cookie)).body.total).toBe(0);
  });

  it('filters by userId and operator', async () => {
    const admin = await loginAs('admin');
    await insert('2026-01-01T10:00:00Z', { userId: admin.user.id });
    await insert('2026-01-01T10:00:01Z', { op: true });
    await insert('2026-01-01T10:00:02Z');
    expect((await get(`/api/audit-log?userId=${admin.user.id}`, admin.cookie)).body.total).toBe(1);
    const op = await get('/api/audit-log?userId=operator', admin.cookie);
    expect(op.body.total).toBe(1);
    expect(op.body.entries[0].isOperator).toBe(true);
  });

  it('paginates 50 per page', async () => {
    const admin = await loginAs('admin');
    await pool.query(
      `INSERT INTO audit_log (at, action) SELECT now() - (g || ' seconds')::interval, 'bulk.x' FROM generate_series(1, 60) g`,
    );
    const p1 = await get('/api/audit-log', admin.cookie);
    const p2 = await get('/api/audit-log?page=2', admin.cookie);
    expect(p1.body.entries).toHaveLength(50);
    expect(p2.body.entries).toHaveLength(10);
    expect(p2.body.page).toBe(2);
    expect(p2.body.total).toBe(60);
  });

  it.each([
    'from=2026-13-01', 'to=2026-02-30', 'from=10.03.2026', 'userId=abc', 'userId=1.5', 'userId=99999999999',
    'page=0', 'page=-1', 'page=x', `action=${'a'.repeat(101)}`, 'from=2026-01-01&from=2026-01-02',
  ])('rejects invalid query %s with 400', async (qs) => {
    const admin = await loginAs('admin');
    const res = await get(`/api/audit-log?${qs}`, admin.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Uu]ngültig/);
  });

  describe('csv', () => {
    it('exports BOM, header, CRLF, quoting and formula neutralization', async () => {
      const admin = await loginAs('admin');
      await insert('2026-01-01T10:00:00Z', { actor: 'A;B "C"', op: true, action: 'x.y', entityType: '=cmd', entityId: '7', ip: null });
      await insert('2026-01-02T10:00:00Z', { actor: '@evil', action: 'x.z' });
      const res = await get('/api/audit-log?format=csv', admin.cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="audit-log.csv"');
      expect(res.text.startsWith('﻿Zeitpunkt;Nutzer;Support-Zugang;Aktion;Objekt;Objekt-ID;IP\r\n')).toBe(true);
      const lines = res.text.slice(1).split('\r\n');
      expect(lines[1]).toBe("2026-01-02T10:00:00.000Z;'@evil;nein;x.z;;;1.2.3.4");
      expect(lines[2]).toBe('2026-01-01T10:00:00.000Z;"A;B ""C""";ja;x.y;\'=cmd;7;');
    });

    it('applies filters and ignores pagination', async () => {
      const admin = await loginAs('admin');
      await pool.query(
        `INSERT INTO audit_log (at, action) SELECT now() - (g || ' seconds')::interval, 'bulk.x' FROM generate_series(1, 60) g`,
      );
      await insert('2026-01-01T10:00:00Z', { action: 'other.y' });
      const res = await get('/api/audit-log?format=csv&action=bulk.', admin.cookie);
      expect(res.text.trimEnd().split('\r\n')).toHaveLength(61);
      expect((await get('/api/audit-log?format=csv&from=bad', admin.cookie)).status).toBe(400);
    });
  });
});
