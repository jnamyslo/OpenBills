import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, waitForAudit, ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';
import { PUBLIC_API_PATHS } from '../auth/middleware.js';
import { hashToken } from '../auth/crypto.js';

// Mount-Basen direkt aus dem Express-Router-Stack ableiten (nicht hart kodiert).
function mountedApiBases(app) {
  const bases = new Set();
  for (const layer of app._router.stack) {
    const m = /^\^((?:\\\/[^\\?]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
    if (!m) continue;
    const path = m[1].replace(/\\\//g, '/').replace(/\\(.)/g, '$1');
    if (path.startsWith('/api/')) bases.add(path);
  }
  return [...bases];
}

const app = createApp();
const bases = mountedApiBases(app);

describe('PUBLIC_API_PATHS', () => {
  const isPublic = (method, path) => PUBLIC_API_PATHS.some((p) => p.method === method && p.pattern.test(path));

  it('erlaubt genau die Whitelist', () => {
    expect(isPublic('POST', '/auth/login')).toBe(true);
    expect(isPublic('POST', '/auth/login/totp')).toBe(true);
    expect(isPublic('GET', '/auth/setup/abc_-1')).toBe(true);
    expect(isPublic('POST', '/auth/setup')).toBe(true);
    expect(isPublic('GET', '/auth/invite/abc')).toBe(true);
    expect(isPublic('POST', '/auth/invite/abc')).toBe(true);
    expect(isPublic('POST', '/auth/password-reset/request')).toBe(true);
    expect(isPublic('GET', '/auth/password-reset/abc')).toBe(true);
    expect(isPublic('POST', '/auth/password-reset/abc')).toBe(true);
    expect(isPublic('GET', '/auth/password-policy')).toBe(true);
  });

  it('lässt keine Umgehungen durch', () => {
    for (const [method, path] of [
      ['GET', '/auth/login'],
      ['POST', '/auth/loginX'],
      ['POST', '/auth/login/../../customers'],
      ['POST', '/auth/login/totp/x'],
      ['GET', '/auth/setup'],
      ['GET', '/auth/setup/a/b'],
      ['GET', '/auth/invite/'],
      ['GET', '/auth/invite/a/../../../customers'],
      ['GET', '/auth/password-reset/request/x'],
      ['POST', '/auth/logout'],
      ['GET', '/auth/me'],
      ['POST', '/auth/password-policy'],
      ['GET', '/auth/password-policy/x'],
      ['GET', '/customers'],
      ['POST', '/x/auth/login'],
    ]) {
      expect(isPublic(method, path), `${method} ${path}`).toBe(false);
    }
  });
});

describe.skipIf(!hasDb)('Zugriffskontrolle (DB)', () => {
  beforeAll(async () => {
    await migrateTestDb();
    await pool.query(
      `INSERT INTO company (id, name, address, city, postal_code, country, phone, email, tax_id)
       VALUES (1, 'Testfirma', 'Str. 1', 'Berlin', '10115', 'Deutschland', '0', 'a@b.de', 'DE1')
       ON CONFLICT (id) DO NOTHING`
    );
  });
  afterAll(() => pool.end());
  beforeEach(resetAuthTables);

  it('findet die gemounteten API-Basen', () => {
    expect(bases.length).toBeGreaterThanOrEqual(17);
    for (const b of ['/api/customers', '/api/company', '/api/backup', '/api/auth', '/api/users', '/api/audit-log', '/api/plan']) {
      expect(bases).toContain(b);
    }
  });

  it.each(bases)('GET %s ohne Cookie -> 401 AUTH_REQUIRED', async (base) => {
    const res = await request(app).get(base);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Nicht angemeldet', code: 'AUTH_REQUIRED' });
  });

  it('unbekannte /api-Pfade ohne Cookie -> 401', async () => {
    expect((await request(app).get('/api/gibt-es-nicht')).status).toBe(401);
  });

  it('GET /api/auth/password-policy ohne Cookie -> 200 mit Mindestlänge', async () => {
    const res = await request(app).get('/api/auth/password-policy');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ minLength: 12, maxLength: 128 });
  });

  it('GET /health ohne Cookie -> nicht 401', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
  });

  it('öffentliche Auth-Pfade sind ohne Cookie erreichbar', async () => {
    const res = await request(app).post('/api/auth/login').set(ORIGIN).send({});
    expect(res.status).not.toBe(401);
    const bad = await request(app).post('/api/auth/loginX').set(ORIGIN).send({});
    expect(bad.status).toBe(401);
  });

  it('Bodies werden erst nach der Authentifizierung geparst', async () => {
    const big = { data: 'x'.repeat(150 * 1024) };
    const res = await request(app).post('/api/customers').set(ORIGIN).send(big);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    const login = await request(app).post('/api/auth/login').set(ORIGIN).send(big);
    expect(login.status).toBe(413);
  });

  describe('als user', () => {
    let cookie;
    beforeEach(async () => {
      ({ cookie } = await loginAs('user'));
    });
    const as = (req) => req.set('Cookie', cookie).set(ORIGIN);

    it('PUT /api/company -> 403', async () => {
      const res = await as(request(app).put('/api/company')).send({ name: 'X' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Keine Berechtigung', code: 'FORBIDDEN' });
    });
    it('GET /api/company -> 200', async () => {
      expect((await as(request(app).get('/api/company'))).status).toBe(200);
    });
    it('POST /api/hourly-rates -> 403', async () => {
      expect((await as(request(app).post('/api/hourly-rates')).send({ name: 'X', rate: 1 })).status).toBe(403);
    });
    it('Schreibzugriffe auf material-templates und yearly-invoice-start-numbers -> 403', async () => {
      expect((await as(request(app).post('/api/material-templates')).send({})).status).toBe(403);
      expect((await as(request(app).post('/api/yearly-invoice-start-numbers')).send({})).status).toBe(403);
    });
    it('GET /api/backup/list -> 403', async () => {
      expect((await as(request(app).get('/api/backup/list'))).status).toBe(403);
    });
    it('GET /api/email-management/smtp-settings -> 403', async () => {
      expect((await as(request(app).get('/api/email-management/smtp-settings'))).status).toBe(403);
    });
    it('SMTP-Test/Diagnose -> 403', async () => {
      for (const p of ['smtp-settings', 'debug-config', 'diagnose-smtp', 'test-smtp']) {
        expect((await as(request(app).post(`/api/email-management/${p}`)).send({})).status, p).toBe(403);
      }
    });
    it('GET /api/email-management/history -> 200', async () => {
      expect((await as(request(app).get('/api/email-management/history'))).status).toBe(200);
    });
    it('GET /api/users und /api/audit-log -> 403', async () => {
      expect((await as(request(app).get('/api/users'))).status).toBe(403);
      expect((await as(request(app).get('/api/audit-log'))).status).toBe(403);
    });
  });

  it('als admin: PUT /api/company -> 200 und Audit-Eintrag', async () => {
    const { cookie, user } = await loginAs('admin');
    const res = await request(app).put('/api/company').set('Cookie', cookie).set(ORIGIN).send({ name: 'Neue Firma' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Neue Firma');
    const rows = await waitForAudit('PUT /api/company');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(user.id);
    expect(rows[0].entity_type).toBe('company');
    expect(rows[0].details).toBeNull();
  });

  it('POST mit fremdem Origin -> 403 ORIGIN_MISMATCH', async () => {
    const { cookie } = await loginAs('user');
    const res = await request(app).post('/api/customers').set('Cookie', cookie).set('Origin', 'https://evil.example').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_MISMATCH');
  });

  it('POST ohne Origin und ohne Referer -> 403', async () => {
    const { cookie } = await loginAs('user');
    const res = await request(app).post('/api/customers').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_MISMATCH');
  });

  it('Referer mit passendem Origin wird akzeptiert, fremder nicht', async () => {
    const { cookie } = await loginAs('admin');
    const ok = await request(app).put('/api/company').set('Cookie', cookie).set('Referer', 'https://test.example/#settings').send({});
    expect(ok.status).toBe(200);
    const bad = await request(app).put('/api/company').set('Cookie', cookie).set('Referer', 'https://test.example.evil.example/').send({});
    expect(bad.status).toBe(403);
  });

  it('Login-Endpunkt prüft Origin ebenfalls', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_MISMATCH');
  });

  it('Session mit last_seen_at -13 h -> 401', async () => {
    const { cookie, token } = await loginAs('user');
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '13 hours' WHERE id_hash = $1`, [hashToken(token)]);
    const res = await request(app).get('/api/customers').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('mfa_pending-Session: nur login/totp und logout', async () => {
    const { cookie } = await loginAs('admin', { mfaPending: true });
    const res = await request(app).get('/api/customers').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MFA_REQUIRED');
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.code).toBe('MFA_REQUIRED');
    expect((await request(app).get('/api/users').set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie).set(ORIGIN)).status).not.toBe(401);
    expect((await request(app).post('/api/auth/login/totp').set('Cookie', cookie).set(ORIGIN)).status).not.toBe(401);
  });

  it('Großschreibung und Slash-Varianten bleiben geschützt', async () => {
    expect((await request(app).get('/API/CUSTOMERS')).status).toBe(401);
    expect((await request(app).get('/api/customers/')).status).toBe(401);
    const { cookie } = await loginAs('user');
    expect((await request(app).get('/API/BACKUP/list').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).put('/api/Company').set('Cookie', cookie).set(ORIGIN).send({})).status).toBe(403);
  });
});
