import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import logger from '../utils/logger.js';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { ORIGIN, waitForAudit } from './helpers/auth.js';
import { createApp } from '../app.js';
import { createUser } from '../auth/users.js';
import { hashPassword } from '../auth/password.js';
import { encryptSecret, hashToken } from '../auth/crypto.js';
import { generateTotpSecret, totpCode } from '../auth/totp.js';

const app = createApp();
const PASSWORD = 'korrektes-pferd-batterie';
const WRONG = 'falsches-passwort-123';
let passwordHash;

const post = (path, body, cookie) => {
  const req = request(app).post(path).set(ORIGIN);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
const get = (path, cookie) => {
  const req = request(app).get(path);
  if (cookie) req.set('Cookie', cookie);
  return req;
};
const sessionCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('ob_session=')).split(';')[0];

async function makeUser(email = 'max@firma.de', extra = {}) {
  return createUser(pool, { email, name: 'Max', passwordHash, role: 'user', ...extra });
}

async function enableTotp(userId) {
  const secret = generateTotpSecret();
  await pool.query('UPDATE users SET totp_secret_enc = $2, totp_enabled_at = now() WHERE id = $1', [
    userId,
    encryptSecret(secret),
  ]);
  return secret;
}

describe.skipIf(!hasDb)('POST /api/auth/login und Co.', () => {
  beforeAll(async () => {
    await migrateTestDb();
    passwordHash = await hashPassword(PASSWORD);
  });
  afterAll(() => pool.end());
  beforeEach(resetAuthTables);

  it('Login korrekt setzt HttpOnly-Cookie, /me liefert Nutzer', async () => {
    await makeUser();
    const res = await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('max@firma.de');
    const raw = res.headers['set-cookie'].join(';');
    expect(raw).toContain('ob_session=');
    expect(raw).toContain('HttpOnly');
    const me = await get('/api/auth/me', sessionCookie(res));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('max@firma.de');
    const rows = await waitForAudit('auth.login');
    expect(rows).toHaveLength(1);
  });

  it('normalisiert die E-Mail beim Login', async () => {
    await makeUser();
    const res = await post('/api/auth/login', { email: ' MAX@firma.de ', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('Support-Zugang: auth.login mit operator-Details', async () => {
    await makeUser('support@openbills.de', { role: 'admin', isOperator: true });
    expect((await post('/api/auth/login', { email: 'support@openbills.de', password: PASSWORD })).status).toBe(200);
    const rows = await waitForAudit('auth.login');
    expect(rows[0].details).toEqual({ operator: true });
    expect(rows[0].is_operator).toBe(true);
  });

  it('unbekannte E-Mail und falsches Passwort antworten identisch', async () => {
    await makeUser();
    const unknown = await post('/api/auth/login', { email: 'niemand@firma.de', password: WRONG });
    const wrong = await post('/api/auth/login', { email: 'max@firma.de', password: WRONG });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toEqual({ error: 'E-Mail oder Passwort falsch' });
    expect((await waitForAudit('auth.login_failed')).length).toBeGreaterThanOrEqual(1);
  });

  it('zu langes Passwort -> 401 wie falsches Passwort', async () => {
    await makeUser();
    const res = await post('/api/auth/login', { email: 'max@firma.de', password: 'x'.repeat(129) });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'E-Mail oder Passwort falsch' });
  });

  it('6. Fehlversuch pro Account -> 429 mit Retry-After, auch bei wechselnder IP', async () => {
    await makeUser();
    for (let i = 1; i <= 5; i += 1) {
      const res = await post('/api/auth/login', { email: 'max@firma.de', password: WRONG })
        .set('X-Forwarded-For', `10.0.0.${i}`);
      expect(res.status).toBe(401);
    }
    const res = await request(app).post('/api/auth/login').set(ORIGIN).set('X-Forwarded-For', '10.0.0.99')
      .send({ email: 'max@firma.de', password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('10 Fehlversuche -> 423, danach auch korrektes Passwort -> 423', async () => {
    await makeUser();
    for (let i = 1; i <= 10; i += 1) {
      await pool.query('DELETE FROM rate_limits');
      const res = await post('/api/auth/login', { email: 'max@firma.de', password: WRONG });
      expect(res.status).toBe(401);
    }
    await pool.query('DELETE FROM rate_limits');
    const res = await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body).toEqual({ error: 'Konto vorübergehend gesperrt', code: 'ACCOUNT_LOCKED' });
    expect(await waitForAudit('auth.locked')).toHaveLength(1);
  });

  describe('mit TOTP', () => {
    let user;
    let secret;
    beforeEach(async () => {
      user = await makeUser();
      secret = await enableTotp(user.id);
    });
    const login = async () => {
      const res = await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mfaRequired: true });
      return sessionCookie(res);
    };

    it('Pending-Session, TOTP-Code, Replay und Recovery-Codes', async () => {
      const pending = await login();
      const blocked = await get('/api/customers', pending);
      expect(blocked.status).toBe(401);
      expect(blocked.body.code).toBe('MFA_REQUIRED');
      expect((await get('/api/auth/me', pending)).status).toBe(401);
      expect(await waitForAudit('auth.login', { timeoutMs: 100 })).toHaveLength(0);

      const code = totpCode(secret, Date.now());
      const ok = await post('/api/auth/login/totp', { code }, pending);
      expect(ok.status).toBe(200);
      expect(ok.body.user.email).toBe('max@firma.de');
      expect((await get('/api/auth/me', pending)).status).toBe(200);
      expect(await waitForAudit('auth.login')).toHaveLength(1);

      const pending2 = await login();
      const replay = await post('/api/auth/login/totp', { code }, pending2);
      expect(replay.status).toBe(401);

      await pool.query('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [
        user.id,
        hashToken('abcd-efgh'),
      ]);
      const rec = await post('/api/auth/login/totp', { code: ' ABCD-efgh ' }, pending2);
      expect(rec.status).toBe(200);
      expect(await waitForAudit('auth.recovery_code_used')).toHaveLength(1);

      const pending3 = await login();
      expect((await post('/api/auth/login/totp', { code: 'abcd-efgh' }, pending3)).status).toBe(401);
    });

    it('/login/totp ohne Pending-Session -> 400', async () => {
      expect((await post('/api/auth/login/totp', { code: '123456' })).status).toBe(400);
    });

    it('/login/totp mit voller Session -> 400', async () => {
      const pending = await login();
      expect((await post('/api/auth/login/totp', { code: totpCode(secret, Date.now()) }, pending)).status).toBe(200);
      expect((await post('/api/auth/login/totp', { code: '123456' }, pending)).status).toBe(400);
    });

    it('6. falscher TOTP-Code -> 429', async () => {
      const pending = await login();
      for (let i = 0; i < 5; i += 1) {
        expect((await post('/api/auth/login/totp', { code: 'zzzz-zzzz' }, pending)).status).toBe(401);
      }
      const res = await post('/api/auth/login/totp', { code: totpCode(secret, Date.now()) }, pending);
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('RATE_LIMITED');
    });

    it('defektes Secret zählt als falscher Code', async () => {
      await pool.query(`UPDATE users SET totp_secret_enc = 'v1:kaputt' WHERE id = $1`, [user.id]);
      const pending = await login();
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        expect((await post('/api/auth/login/totp', { code: '123456' }, pending)).status).toBe(401);
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('Passwortwechsel', () => {
    it('falsches aktuelles Passwort -> 400', async () => {
      await makeUser();
      const cookie = sessionCookie(await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD }));
      const res = await post('/api/auth/password', { currentPassword: WRONG, newPassword: 'neues-langes-passwort' }, cookie);
      expect(res.status).toBe(400);
    });

    it('schwaches neues Passwort -> 400 mit Meldung', async () => {
      await makeUser();
      const cookie = sessionCookie(await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD }));
      const res = await post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'kurz' }, cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('mindestens 12 Zeichen');
    });

    it('Erfolg beendet andere Sessions, eigene bleibt, neues Passwort gilt', async () => {
      await makeUser();
      const mine = sessionCookie(await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD }));
      const other = sessionCookie(await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD }));
      const res = await post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'neues-langes-passwort' }, mine);
      expect(res.status).toBe(204);
      expect((await get('/api/auth/me', other)).status).toBe(401);
      expect((await get('/api/auth/me', mine)).status).toBe(200);
      expect(await waitForAudit('auth.password_changed')).toHaveLength(1);
      expect((await post('/api/auth/login', { email: 'max@firma.de', password: 'neues-langes-passwort' })).status).toBe(200);
    });
  });

  it('Logout löscht Cookie und Session', async () => {
    await makeUser();
    const cookie = sessionCookie(await post('/api/auth/login', { email: 'max@firma.de', password: PASSWORD }));
    const res = await post('/api/auth/logout', {}, cookie);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].join(';')).toMatch(/ob_session=;.*Expires=Thu, 01 Jan 1970/);
    expect((await get('/api/auth/me', cookie)).status).toBe(401);
    expect(await waitForAudit('auth.logout')).toHaveLength(1);
  });

  it('fehlende Felder -> 400', async () => {
    expect((await post('/api/auth/login', {})).status).toBe(400);
  });
});
