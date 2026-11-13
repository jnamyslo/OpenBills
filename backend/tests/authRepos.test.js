import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import logger from '../utils/logger.js';
import { AuthError, sendAuthError } from '../auth/errors.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { normalizeEmail } from '../auth/users.js';
import { describeRequest } from '../auth/audit.js';

describe('normalizeEmail', () => {
  it('trimmt und macht klein', () => {
    expect(normalizeEmail(' Max@Firma.DE ')).toBe('max@firma.de');
  });
});

describe('sendAuthError', () => {
  const fakeRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  it('AuthError: Status, Meldung und Code', () => {
    const res = fakeRes();
    sendAuthError(res, new AuthError(400, 'Ungültig', 'x'));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Ungültig', code: 'x' });
  });
  it('andere Fehler: 500 ohne Details, geloggt', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = fakeRes();
    sendAuthError(res, new Error('secret db detail'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Interner Fehler' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('describeRequest', () => {
  it('ersetzt UUIDs und entfernt Query', () => {
    expect(describeRequest('PUT', '/api/invoices/123e4567-e89b-12d3-a456-426614174000?x=1')).toEqual({
      action: 'PUT /api/invoices/:id',
      entityType: 'invoices',
      entityId: '123e4567-e89b-12d3-a456-426614174000',
    });
  });
  it('ohne ID', () => {
    expect(describeRequest('POST', '/api/customers')).toEqual({
      action: 'POST /api/customers',
      entityType: 'customers',
      entityId: null,
    });
  });
  it('numerische IDs', () => {
    expect(describeRequest('DELETE', '/api/jobs/42/items/7')).toEqual({
      action: 'DELETE /api/jobs/:id/items/:id',
      entityType: 'jobs',
      entityId: '42',
    });
  });
});

describe.skipIf(!hasDb)('Auth-Repos (DB)', () => {
  let pool, users, tokens, rl, auditMod;

  beforeAll(async () => {
    ({ pool } = await import('../database.js'));
    users = await import('../auth/users.js');
    tokens = await import('../auth/tokens.js');
    rl = await import('../auth/rateLimit.js');
    auditMod = await import('../auth/audit.js');
    await migrateTestDb();
  });
  beforeEach(resetAuthTables);
  afterAll(async () => {
    await pool.end();
  });

  async function mkUser(email = 'A@x.de', extra = {}) {
    const c = await pool.connect();
    try {
      return await users.createUser(c, { email, name: 'A', passwordHash: 'h', role: 'admin', ...extra });
    } finally {
      c.release();
    }
  }

  it('Nutzer: E-Mail normalisiert, Admin-Zählung, public user', async () => {
    const u = await mkUser(' A@X.de ');
    expect(u.email).toBe('a@x.de');
    expect((await users.findUserByEmail('A@x.DE')).id).toBe(u.id);
    await mkUser('support@openbills.de', { isOperator: true });
    const c = await pool.connect();
    try {
      expect(await users.countActiveCustomerAdmins(c)).toBe(1);
      expect(await users.hasCustomerAdmin(c)).toBe(true);
    } finally {
      c.release();
    }
    expect(users.toPublicUser(u)).toMatchObject({ id: u.id, isOperator: false, totpEnabled: false });
  });

  it('Token-Lebenszyklus', async () => {
    const t = await tokens.createAuthToken({ kind: 'invite', email: 'B@x.de', role: 'user', ttlMs: 60000 });
    expect((await tokens.peekAuthToken(t, 'invite')).status).toBe('valid');
    expect((await tokens.peekAuthToken(t, 'onboarding')).status).toBe('invalid');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const row = await tokens.consumeAuthToken(c, t, 'invite');
      expect(row.email).toBe('b@x.de');
      await c.query('COMMIT');
      await c.query('BEGIN');
      await expect(tokens.consumeAuthToken(c, t, 'invite')).rejects.toMatchObject({ status: 400 });
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    expect((await tokens.peekAuthToken(t, 'invite')).status).toBe('used');
    const e = await tokens.createAuthToken({ kind: 'invite', ttlMs: -1 });
    expect((await tokens.peekAuthToken(e, 'invite')).status).toBe('expired');
    expect((await tokens.peekAuthToken('zufall', 'invite')).status).toBe('invalid');
  });

  it('revokeTokens', async () => {
    const u = await mkUser();
    const t = await tokens.createAuthToken({ kind: 'password_reset', userId: u.id, ttlMs: 60000 });
    await tokens.revokeTokens({ kind: 'password_reset', userId: u.id });
    expect((await tokens.peekAuthToken(t, 'password_reset')).status).toBe('used');
  });

  it('Rate-Limit', async () => {
    for (let i = 0; i < 5; i++) await rl.recordAttempt('k1', 900000);
    expect(await rl.checkRateLimit('k1', 5, 900000)).toBeGreaterThan(0);
    expect(await rl.checkRateLimit('k2', 5, 900000)).toBe(0);
    await rl.clearRateLimit('k1');
    expect(await rl.checkRateLimit('k1', 5, 900000)).toBe(0);
  });

  it('Rate-Limit-Fenster läuft ab', async () => {
    for (let i = 0; i < 5; i++) await rl.recordAttempt('k3', 900000);
    await pool.query(`UPDATE rate_limits SET window_start = now() - interval '1 hour' WHERE key = 'k3'`);
    expect(await rl.checkRateLimit('k3', 5, 900000)).toBe(0);
    await rl.recordAttempt('k3', 900000);
    const { rows } = await pool.query(`SELECT count FROM rate_limits WHERE key = 'k3'`);
    expect(rows[0].count).toBe(1);
  });

  it('Login-Sperre nach 10 Fehlversuchen', async () => {
    const u = await mkUser();
    let r;
    for (let i = 0; i < 9; i++) {
      r = await users.recordLoginFailure(u.id);
      expect(r.lockedUntil).toBeNull();
    }
    r = await users.recordLoginFailure(u.id);
    expect(r.lockedUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60000);
    expect(r.lockedUntil.getTime()).toBeLessThan(Date.now() + 16 * 60000);
    expect((await users.findUserById(u.id)).failed_login_count).toBe(0);
    await users.recordLoginSuccess(u.id);
    const after = await users.findUserById(u.id);
    expect(after.locked_until).toBeNull();
    expect(after.last_login_at).not.toBeNull();
  });

  it('audit schreibt Zeile und wirft nie; cleanup löscht alte', async () => {
    const req = { ip: '1.2.3.4', get: () => 'UA', user: { id: 1, name: 'Max', email: 'm@x.de', is_operator: true } };
    await auditMod.audit(req, { action: 'X', details: { status: 200 } });
    await auditMod.audit(null, { action: 'Y' });
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await auditMod.audit(null, { action: 'Z', entityType: 'a'.repeat(500) }); // schlägt fehl, darf nicht werfen
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY id');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor_label: 'Max', is_operator: true, ip: '1.2.3.4', user_agent: 'UA' });
    expect(rows[1].actor_label).toBe('System');

    await pool.query(`INSERT INTO audit_log (at, action) VALUES (now() - interval '91 days', 'old'), (now() - interval '1 day', 'recent')`);
    expect(await auditMod.cleanupAuditLog()).toBe(1);
    const { rows: left } = await pool.query(`SELECT action FROM audit_log WHERE action IN ('old','recent')`);
    expect(left.map((r) => r.action)).toEqual(['recent']);
  });
});
