import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import logger from '../utils/logger.js';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { ORIGIN, waitForAudit } from './helpers/auth.js';
import { createUser, countActiveCustomerAdmins } from '../auth/users.js';
import { hashPassword } from '../auth/password.js';
import { createAuthToken } from '../auth/tokens.js';
import { totpCode, verifyTotp } from '../auth/totp.js';

const mail = vi.hoisted(() => ({
  isSmtpConfigured: vi.fn(async () => true),
  sendPasswordResetMail: vi.fn(async () => {}),
  sendInviteMail: vi.fn(async () => {}),
}));
vi.mock('../services/authMailService.js', () => mail);

const { createApp } = await import('../app.js');

const app = createApp();
const PASSWORD = 'korrektes-pferd-batterie';
const NEW_PASSWORD = 'ganz-neues-passwort-42';
const HOUR = 60 * 60 * 1000;
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
const login = (email, password) => post('/api/auth/login', { email, password });

const onboarding = (ttlMs = 48 * HOUR) => createAuthToken({ kind: 'onboarding', ttlMs });
const setupBody = (token, extra = {}) => ({
  token, name: 'Erika Admin', email: 'Erika@Firma.de', password: PASSWORD, ...extra,
});

async function makeUser(email = 'max@firma.de', extra = {}) {
  return createUser(pool, { email, name: 'Max', passwordHash, role: 'user', ...extra });
}

describe.skipIf(!hasDb)('Auth-Flows: Setup, Einladung, Reset, 2FA', () => {
  beforeAll(async () => {
    await migrateTestDb();
    passwordHash = await hashPassword(PASSWORD);
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await resetAuthTables();
    mail.isSmtpConfigured.mockReset().mockResolvedValue(true);
    mail.sendPasswordResetMail.mockReset().mockResolvedValue(undefined);
  });

  describe('Setup', () => {
    it('gültiger Token -> 201 Admin mit Session, zweites Setup -> 409', async () => {
      const token = await onboarding();
      expect((await get(`/api/auth/setup/${token}`)).body).toEqual({ status: 'valid' });

      const res = await post('/api/auth/setup', setupBody(token));
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ email: 'erika@firma.de', role: 'admin', isOperator: false });
      expect((await get('/api/auth/me', sessionCookie(res))).status).toBe(200);
      expect(await waitForAudit('user.setup')).toHaveLength(1);

      expect((await get(`/api/auth/setup/${token}`)).body).toEqual({ status: 'done' });
      const second = await post('/api/auth/setup', setupBody(await onboarding(), { email: 'zwei@firma.de' }));
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('Instanz ist bereits eingerichtet');
    });

    it('abgelaufener, unbekannter und verbrauchter Token -> 400', async () => {
      const expired = await onboarding(-1000);
      expect((await get(`/api/auth/setup/${expired}`)).body).toEqual({ status: 'expired' });
      expect((await post('/api/auth/setup', setupBody(expired))).status).toBe(400);
      expect((await get('/api/auth/setup/unbekannt')).body).toEqual({ status: 'invalid' });
      expect((await post('/api/auth/setup', setupBody('unbekannt'))).status).toBe(400);
      expect(await countActiveCustomerAdmins(pool)).toBe(0);
    });

    it('schwaches Passwort -> 400 mit Meldung, Token bleibt gültig', async () => {
      const token = await onboarding();
      const res = await post('/api/auth/setup', setupBody(token, { password: 'kurz' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('mindestens 12 Zeichen');
      expect((await get(`/api/auth/setup/${token}`)).body).toEqual({ status: 'valid' });
    });

    it('zwei parallele Setups -> genau ein Admin', async () => {
      const [a, b] = await Promise.all([onboarding(), onboarding()]);
      const results = await Promise.all([
        post('/api/auth/setup', setupBody(a, { email: 'a@firma.de' })),
        post('/api/auth/setup', setupBody(b, { email: 'b@firma.de' })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await countActiveCustomerAdmins(pool)).toBe(1);
    });

    it('ignoriert existierenden Support-Zugang', async () => {
      await makeUser('support@openbills.de', { role: 'admin', isOperator: true });
      const token = await onboarding();
      expect((await get(`/api/auth/setup/${token}`)).body).toEqual({ status: 'valid' });
      expect((await post('/api/auth/setup', setupBody(token))).status).toBe(201);
    });

    it('21. Versuch pro IP -> 429', async () => {
      for (let i = 0; i < 20; i += 1) {
        expect((await post('/api/auth/setup', setupBody('falsch'))).status).toBe(400);
      }
      const res = await post('/api/auth/setup', setupBody(await onboarding()));
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('Einladung', () => {
    it('legt Konto mit Rolle und normalisierter E-Mail an, Token nur einmal', async () => {
      const token = await createAuthToken({ kind: 'invite', email: ' NEU@Firma.de ', role: 'user', ttlMs: 48 * HOUR });
      expect((await get(`/api/auth/invite/${token}`)).body).toEqual({ status: 'valid', email: 'neu@firma.de', role: 'user' });

      const res = await post(`/api/auth/invite/${token}`, { name: 'Neu', password: PASSWORD });
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ email: 'neu@firma.de', role: 'user', name: 'Neu' });
      expect((await get('/api/auth/me', sessionCookie(res))).status).toBe(200);
      expect(await waitForAudit('user.invite_accepted')).toHaveLength(1);

      expect((await get(`/api/auth/invite/${token}`)).body).toEqual({ status: 'used' });
      expect((await post(`/api/auth/invite/${token}`, { name: 'Neu', password: PASSWORD })).status).toBe(400);
    });

    it('existierende E-Mail -> 409', async () => {
      await makeUser('neu@firma.de');
      const token = await createAuthToken({ kind: 'invite', email: 'neu@firma.de', role: 'admin', ttlMs: 48 * HOUR });
      expect((await post(`/api/auth/invite/${token}`, { name: 'Neu', password: PASSWORD })).status).toBe(409);
    });

    it('schwaches Passwort -> 400', async () => {
      const token = await createAuthToken({ kind: 'invite', email: 'neu@firma.de', role: 'user', ttlMs: 48 * HOUR });
      const res = await post(`/api/auth/invite/${token}`, { name: 'Neu', password: 'kurz' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('mindestens 12 Zeichen');
    });
  });

  describe('Passwort-Reset', () => {
    const tokenFromMail = () => mail.sendPasswordResetMail.mock.calls[0][1].link.split('#reset/')[1];

    it('identische Antwort für bekannte und unbekannte E-Mail, Reset setzt Passwort', async () => {
      await makeUser();
      const oldSession = sessionCookie(await login('max@firma.de', PASSWORD));

      const unknown = await post('/api/auth/password-reset/request', { email: 'niemand@firma.de' });
      const known = await post('/api/auth/password-reset/request', { email: ' MAX@firma.de ' });
      expect(unknown.status).toBe(200);
      expect(known.status).toBe(unknown.status);
      expect(known.body).toEqual(unknown.body);
      expect(known.body).toEqual({ ok: true });

      await vi.waitFor(() => expect(mail.sendPasswordResetMail).toHaveBeenCalledTimes(1));
      expect(await waitForAudit('auth.password_reset_requested')).toHaveLength(1);
      const [to, { link }] = mail.sendPasswordResetMail.mock.calls[0];
      expect(to).toBe('max@firma.de');
      expect(link).toMatch(/^https:\/\/test\.example\/#reset\/[A-Za-z0-9_-]{43}$/);

      const token = tokenFromMail();
      expect((await get(`/api/auth/password-reset/${token}`)).body).toEqual({ status: 'valid' });
      expect((await post(`/api/auth/password-reset/${token}`, { password: 'kurz' })).status).toBe(400);
      expect((await post(`/api/auth/password-reset/${token}`, { password: NEW_PASSWORD })).status).toBe(204);
      expect(await waitForAudit('auth.password_reset_completed')).toHaveLength(1);

      expect((await get('/api/auth/me', oldSession)).status).toBe(401);
      expect((await login('max@firma.de', PASSWORD)).status).toBe(401);
      expect((await login('max@firma.de', NEW_PASSWORD)).status).toBe(200);
      expect((await post(`/api/auth/password-reset/${token}`, { password: NEW_PASSWORD })).status).toBe(400);
    });

    it('Reset hebt Sperre auf', async () => {
      const user = await makeUser();
      await pool.query(`UPDATE users SET failed_login_count = 7, locked_until = now() + interval '10 minutes' WHERE id = $1`, [user.id]);
      await post('/api/auth/password-reset/request', { email: 'max@firma.de' });
      await vi.waitFor(() => expect(mail.sendPasswordResetMail).toHaveBeenCalledTimes(1));
      expect((await post(`/api/auth/password-reset/${tokenFromMail()}`, { password: NEW_PASSWORD })).status).toBe(204);
      const { rows } = await pool.query('SELECT failed_login_count, locked_until FROM users WHERE id = $1', [user.id]);
      expect(rows[0]).toEqual({ failed_login_count: 0, locked_until: null });
    });

    it('neuer Reset-Token entwertet den älteren', async () => {
      await makeUser();
      await post('/api/auth/password-reset/request', { email: 'max@firma.de' });
      await vi.waitFor(() => expect(mail.sendPasswordResetMail).toHaveBeenCalledTimes(1));
      const first = tokenFromMail();
      await post('/api/auth/password-reset/request', { email: 'max@firma.de' });
      await vi.waitFor(() => expect(mail.sendPasswordResetMail).toHaveBeenCalledTimes(2));
      expect((await get(`/api/auth/password-reset/${first}`)).body).toEqual({ status: 'used' });
    });

    it('ohne SMTP, inaktiver Nutzer oder Mailfehler -> 200 ohne Leck', async () => {
      await makeUser();
      await makeUser('inaktiv@firma.de');
      await pool.query(`UPDATE users SET is_active = false WHERE email = 'inaktiv@firma.de'`);

      const inactive = await post('/api/auth/password-reset/request', { email: 'inaktiv@firma.de' });
      expect(inactive.status).toBe(200);
      expect(inactive.body).toEqual({ ok: true });

      mail.isSmtpConfigured.mockResolvedValue(false);
      expect((await post('/api/auth/password-reset/request', { email: 'max@firma.de' })).body).toEqual({ ok: true });
      // inaktiver Nutzer bricht vor der SMTP-Prüfung ab, daher genau ein Aufruf
      await vi.waitFor(() => expect(mail.isSmtpConfigured).toHaveBeenCalledTimes(1));
      expect(mail.sendPasswordResetMail).not.toHaveBeenCalled();
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM auth_tokens')).rows[0].n).toBe(0);

      mail.isSmtpConfigured.mockResolvedValue(true);
      mail.sendPasswordResetMail.mockRejectedValue(new Error('SMTP kaputt'));
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        const failed = await post('/api/auth/password-reset/request', { email: 'max@firma.de' });
        expect(failed.status).toBe(200);
        expect(failed.body).toEqual({ ok: true });
        await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('Passwort-Reset-Anfrage fehlgeschlagen', { error: 'SMTP kaputt' }));
        expect(mail.sendPasswordResetMail).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('6. Anfrage pro E-Mail -> 429, auch für unbekannte E-Mail', async () => {
      for (const email of ['max@firma.de', 'niemand@firma.de']) {
        for (let i = 0; i < 5; i += 1) {
          const res = await post('/api/auth/password-reset/request', { email }).set('X-Forwarded-For', `10.2.0.${i}`);
          expect(res.status).toBe(200);
        }
        const res = await post('/api/auth/password-reset/request', { email }).set('X-Forwarded-For', '10.2.0.99');
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('RATE_LIMITED');
      }
    });
  });

  describe('2FA verwalten', () => {
    const wrongCode = (secret) => {
      for (let n = 0; ; n += 1) {
        const c = String(n).padStart(6, '0');
        if (verifyTotp(secret, c, null) === null) return c;
      }
    };

    it('setup -> enable -> Login verlangt MFA -> disable', async () => {
      await makeUser();
      const cookie = sessionCookie(await login('max@firma.de', PASSWORD));

      const setup = await post('/api/auth/totp/setup', {}, cookie);
      expect(setup.status).toBe(200);
      const { secret, otpauthUri } = setup.body;
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(otpauthUri).toContain(`secret=${secret}`);
      const { rows: [pending] } = await pool.query('SELECT totp_pending_enc, totp_secret_enc FROM users');
      expect(pending.totp_pending_enc).toMatch(/^v1:/);
      expect(pending.totp_secret_enc).toBeNull();

      const bad = await post('/api/auth/totp/enable', { code: wrongCode(secret) }, cookie);
      expect(bad.status).toBe(400);

      const ok = await post('/api/auth/totp/enable', { code: totpCode(secret, Date.now()) }, cookie);
      expect(ok.status).toBe(200);
      expect(ok.body.recoveryCodes).toHaveLength(10);
      expect(ok.body.recoveryCodes[0]).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/);
      expect(await waitForAudit('auth.totp_enabled')).toHaveLength(1);
      const { rows: [enabled] } = await pool.query('SELECT totp_pending_enc, totp_secret_enc, totp_enabled_at FROM users');
      expect(enabled.totp_pending_enc).toBeNull();
      expect(enabled.totp_secret_enc).toMatch(/^v1:/);
      expect(enabled.totp_enabled_at).not.toBeNull();
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM user_recovery_codes')).rows[0].n).toBe(10);

      const mfa = await login('max@firma.de', PASSWORD);
      expect(mfa.body).toEqual({ mfaRequired: true });
      // Recovery-Code aus enable funktioniert beim Login
      const rec = await post('/api/auth/login/totp', { code: ok.body.recoveryCodes[0].toUpperCase() }, sessionCookie(mfa));
      expect(rec.status).toBe(200);

      expect((await post('/api/auth/totp/disable', { password: PASSWORD, code: wrongCode(secret) }, cookie)).status).toBe(400);
      expect((await post('/api/auth/totp/disable', { password: 'falsches-passwort-1', code: totpCode(secret, Date.now() + 30000) }, cookie)).status).toBe(400);
      const off = await post('/api/auth/totp/disable', { password: PASSWORD, code: totpCode(secret, Date.now() + 30000) }, cookie);
      expect(off.status).toBe(204);
      expect(await waitForAudit('auth.totp_disabled')).toHaveLength(1);
      const { rows: [disabled] } = await pool.query('SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM users');
      expect(disabled).toEqual({ totp_secret_enc: null, totp_enabled_at: null, totp_last_step: null });
      expect((await pool.query('SELECT COUNT(*)::int AS n FROM user_recovery_codes')).rows[0].n).toBe(0);
      expect((await login('max@firma.de', PASSWORD)).body.user).toBeDefined();
    });

    it('enable ohne setup -> 400, setup bei aktiver 2FA -> 409', async () => {
      await makeUser();
      const cookie = sessionCookie(await login('max@firma.de', PASSWORD));
      expect((await post('/api/auth/totp/enable', { code: '123456' }, cookie)).status).toBe(400);
      const { secret } = (await post('/api/auth/totp/setup', {}, cookie)).body;
      expect((await post('/api/auth/totp/enable', { code: totpCode(secret, Date.now()) }, cookie)).status).toBe(200);
      expect((await post('/api/auth/totp/setup', {}, cookie)).status).toBe(409);
    });

    it('6. falscher Code bei enable -> 429', async () => {
      await makeUser();
      const cookie = sessionCookie(await login('max@firma.de', PASSWORD));
      const { secret } = (await post('/api/auth/totp/setup', {}, cookie)).body;
      for (let i = 0; i < 5; i += 1) {
        expect((await post('/api/auth/totp/enable', { code: wrongCode(secret) }, cookie)).status).toBe(400);
      }
      expect((await post('/api/auth/totp/enable', { code: totpCode(secret, Date.now()) }, cookie)).status).toBe(429);
    });

    it('ohne Session -> 401', async () => {
      expect((await post('/api/auth/totp/setup', {})).status).toBe(401);
    });
  });
});
