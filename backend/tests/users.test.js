import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { ORIGIN, loginAs, waitForAudit } from './helpers/auth.js';
import { createUser } from '../auth/users.js';
import { createSession } from '../auth/sessions.js';
import { createAuthToken } from '../auth/tokens.js';
import { hashPassword } from '../auth/password.js';
import { hashToken } from '../auth/crypto.js';

const mail = vi.hoisted(() => ({
  isSmtpConfigured: vi.fn(async () => false),
  sendPasswordResetMail: vi.fn(async () => {}),
  sendInviteMail: vi.fn(async () => {}),
}));
vi.mock('../services/authMailService.js', () => mail);

const { createApp } = await import('../app.js');
const app = createApp();

const call = (method, path, cookie, body) => {
  const req = request(app)[method](path).set(ORIGIN).set('Cookie', cookie);
  return body === undefined ? req : req.send(body);
};

describe.skipIf(!hasDb)('users API', () => {
  beforeAll(migrateTestDb);
  beforeEach(async () => {
    await resetAuthTables();
    mail.isSmtpConfigured.mockImplementation(async () => false);
    mail.sendInviteMail.mockClear();
  });
  afterAll(() => pool.end());

  const mkOperator = () => createUser(pool, {
    email: 'support@openbills.de', name: 'Support', passwordHash: 'x', role: 'admin', isOperator: true,
  });
  const sessionFor = async (user) => `ob_session=${await createSession(user.id)}`;

  it('lists users without operator and reports operator state', async () => {
    const admin = await loginAs('admin');
    const op = await mkOperator();
    const res = await call('get', '/api/users', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.id)).toEqual([admin.user.id]);
    expect(res.body.operator).toEqual({ active: true, lastLoginAt: null });
    expect(op.is_operator).toBe(true);
  });

  it('is forbidden for plain users', async () => {
    const user = await loginAs('user');
    expect((await call('get', '/api/users', user.cookie)).status).toBe(403);
  });

  describe('invite', () => {
    it('creates link, emailed:false without SMTP, 409 on case variant', async () => {
      const admin = await loginAs('admin');
      await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      const ok = await call('post', '/api/users/invite', admin.cookie, { email: 'Neu@Firma.de', role: 'user' });
      expect(ok.status).toBe(201);
      expect(ok.body.emailed).toBe(false);
      expect(ok.body.link).toMatch(/^https:\/\/test\.example\/#invite\/[A-Za-z0-9_-]+$/);
      const dup = await call('post', '/api/users/invite', admin.cookie, { email: 'BOB@firma.de', role: 'user' });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('Diese E-Mail-Adresse ist bereits vergeben');
      await mkOperator();
      const op = await call('post', '/api/users/invite', admin.cookie, { email: 'Support@OpenBills.de', role: 'user' });
      expect(op.status).toBe(409);
      expect((await waitForAudit('user.invited')).length).toBe(1);
    });

    it('validates input', async () => {
      const admin = await loginAs('admin');
      expect((await call('post', '/api/users/invite', admin.cookie, { email: 'kaputt', role: 'user' })).status).toBe(400);
      expect((await call('post', '/api/users/invite', admin.cookie, { email: 'a@b.de', role: 'root' })).status).toBe(400);
    });

    it('sends mail with SMTP, survives send failure, revokes older invites', async () => {
      const admin = await loginAs('admin');
      mail.isSmtpConfigured.mockImplementation(async () => true);
      const first = await call('post', '/api/users/invite', admin.cookie, { email: 'x@firma.de', role: 'admin' });
      expect(first.body.emailed).toBe(true);
      expect(mail.sendInviteMail).toHaveBeenCalledWith('x@firma.de', expect.objectContaining({ link: first.body.link, inviterName: admin.user.name }));
      mail.sendInviteMail.mockRejectedValueOnce(new Error('smtp down'));
      const second = await call('post', '/api/users/invite', admin.cookie, { email: 'x@firma.de', role: 'admin' });
      expect(second.status).toBe(201);
      expect(second.body.emailed).toBe(false);
      const { rows } = await pool.query(`SELECT used_at FROM auth_tokens WHERE kind = 'invite' AND email = 'x@firma.de'`);
      expect(rows.filter((r) => r.used_at === null)).toHaveLength(1);
    });
  });

  describe('invite – Plattform-Limit', () => {
    it('Free: ab 10 per Mail versendeten Einladungen heute nur noch Link, keine Mail', async () => {
      vi.stubEnv('OPENBILLS_PLAN', 'free');
      try {
        const admin = await loginAs('admin');
        mail.isSmtpConfigured.mockImplementation(async () => true);
        for (let i = 0; i < 10; i += 1) {
          const r = await call('post', '/api/users/invite', admin.cookie, { email: `p${i}@firma.de`, role: 'user' });
          expect(r.body.emailed).toBe(true);
        }
        const over = await call('post', '/api/users/invite', admin.cookie, { email: 'p10@firma.de', role: 'user' });
        expect(over.status).toBe(201);
        expect(over.body.emailed).toBe(false);
        expect(over.body.link).toContain('#invite/');
        expect(mail.sendInviteMail).toHaveBeenCalledTimes(10);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('update', () => {
    it('updates name and role, audits without name value', async () => {
      const admin = await loginAs('admin');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      const res = await call('put', `/api/users/${bob.id}`, admin.cookie, { name: 'Robert', role: 'admin', evil: 1 });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ name: 'Robert', role: 'admin' });
      const [row] = await waitForAudit('user.updated');
      expect(row.details).toEqual({ fields: ['name', 'role'], role: 'admin' });
    });

    it('400 when nothing valid', async () => {
      const admin = await loginAs('admin');
      expect((await call('put', `/api/users/${admin.user.id}`, admin.cookie, { foo: 1 })).status).toBe(400);
      expect((await call('put', `/api/users/${admin.user.id}`, admin.cookie, { name: '  ' })).status).toBe(400);
      expect((await call('put', `/api/users/${admin.user.id}`, admin.cookie, { isActive: 'yes' })).status).toBe(400);
    });

    it('blocks demoting or deactivating the last customer admin, operator does not count', async () => {
      const admin = await loginAs('admin');
      await mkOperator();
      const demote = await call('put', `/api/users/${admin.user.id}`, admin.cookie, { role: 'user' });
      expect(demote.status).toBe(409);
      expect(demote.body.error).toBe('Mindestens ein Administrator muss aktiv bleiben');
      expect((await call('put', `/api/users/${admin.user.id}`, admin.cookie, { isActive: false })).status).toBe(409);
    });

    it('allows self-demotion when another admin remains', async () => {
      const a = await loginAs('admin');
      await loginAs('admin');
      expect((await call('put', `/api/users/${a.user.id}`, a.cookie, { role: 'user' })).status).toBe(200);
    });

    it('deactivation ends sessions of that user', async () => {
      const admin = await loginAs('admin');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      const bobCookie = await sessionFor(bob);
      expect((await call('get', '/api/plan', bobCookie)).status).toBe(200);
      expect((await call('put', `/api/users/${bob.id}`, admin.cookie, { isActive: false })).status).toBe(200);
      expect((await call('get', '/api/plan', bobCookie)).status).toBe(401);
    });

    it.each([
      ['demotion', { role: 'user' }],
      ['deactivation', { isActive: false }],
    ])('%s of an admin revokes their unused invites', async (_label, change) => {
      const admin = await loginAs('admin');
      const other = await loginAs('admin');
      const mine = await createAuthToken({ kind: 'invite', email: 'a@firma.de', role: 'user', createdBy: other.user.id, ttlMs: 3600000 });
      const foreign = await createAuthToken({ kind: 'invite', email: 'b@firma.de', role: 'user', createdBy: admin.user.id, ttlMs: 3600000 });
      expect((await call('put', `/api/users/${other.user.id}`, admin.cookie, change)).status).toBe(200);
      expect((await request(app).get(`/api/auth/invite/${mine}`)).body.status).toBe('used');
      expect((await request(app).get(`/api/auth/invite/${foreign}`)).body.status).toBe('valid');
    });

    it('renaming an admin keeps their invites', async () => {
      const admin = await loginAs('admin');
      const token = await createAuthToken({ kind: 'invite', email: 'a@firma.de', role: 'user', createdBy: admin.user.id, ttlMs: 3600000 });
      expect((await call('put', `/api/users/${admin.user.id}`, admin.cookie, { name: 'Neu' })).status).toBe(200);
      expect((await request(app).get(`/api/auth/invite/${token}`)).body.status).toBe('valid');
    });

    it('concurrent demotions leave one admin', async () => {
      const a = await loginAs('admin');
      const b = await loginAs('admin');
      const [r1, r2] = await Promise.all([
        call('put', `/api/users/${a.user.id}`, a.cookie, { role: 'user' }),
        call('put', `/api/users/${b.user.id}`, b.cookie, { role: 'user' }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    });
  });

  describe('unlock', () => {
    const PW = 'korrektes-pferd-batterie';
    const login = (password) => request(app).post('/api/auth/login').set(ORIGIN)
      .set('X-Forwarded-For', '10.9.0.1').send({ email: 'bob@firma.de', password });

    it('hebt Sperre und Login-Limits auf, Passwort und Sessions bleiben', async () => {
      const admin = await loginAs('admin');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: await hashPassword(PW), role: 'user' });
      const bobCookie = await sessionFor(bob);
      for (let i = 0; i < 10; i += 1) {
        if (i === 5) await pool.query('DELETE FROM rate_limits');
        expect((await login('falsches-passwort-123')).status).toBe(401);
      }
      expect((await login(PW)).status).toBe(429);
      const listed = (await call('get', '/api/users', admin.cookie)).body.users.find((u) => u.id === bob.id);
      expect(new Date(listed.lockedUntil).getTime()).toBeGreaterThan(Date.now());
      await pool.query(
        `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 5), ($2, now(), 5), ($3, now(), 5)`,
        [`totp:user:${bob.id}`, `pwchange:user:${bob.id}`, `login:user:${hashToken('other@firma.de')}:10.9.0.1`]
      );

      const res = await call('post', `/api/users/${bob.id}/unlock`, admin.cookie, {});
      expect(res.status).toBe(204);
      const { rows: keys } = await pool.query('SELECT key FROM rate_limits ORDER BY key');
      expect(keys.map((r) => r.key)).toEqual([`login:ip:10.9.0.1`, `login:user:${hashToken('other@firma.de')}:10.9.0.1`]);
      const [row] = await waitForAudit('user.unlocked');
      expect(row).toMatchObject({ entity_type: 'users', entity_id: String(bob.id) });
      expect((await call('get', '/api/plan', bobCookie)).status).toBe(200);

      const ok = await login(PW);
      expect(ok.status).toBe(200);
      expect(ok.body.user.lockedUntil).toBeNull();
    });

    it('is forbidden for plain users', async () => {
      const user = await loginAs('user');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      expect((await call('post', `/api/users/${bob.id}/unlock`, user.cookie, {})).status).toBe(403);
    });
  });

  describe('operator and bad ids', () => {
    it('404 for operator on every :id route, unknown and malformed ids', async () => {
      const admin = await loginAs('admin');
      const op = await mkOperator();
      const cases = [
        ['put', `/api/users/${op.id}`, { role: 'user' }],
        ['post', `/api/users/${op.id}/password-reset-link`],
        ['post', `/api/users/${op.id}/totp/reset`],
        ['delete', `/api/users/${op.id}/sessions`],
        ['post', `/api/users/${op.id}/unlock`],
        ['post', '/api/users/abc/unlock'],
        ['post', '/api/users/99999/unlock'],
        ['put', '/api/users/99999', { role: 'user' }],
        ['put', '/api/users/abc', { role: 'user' }],
        ['put', '/api/users/99999999999999', { role: 'user' }],
        ['delete', '/api/users/1%27/sessions'],
      ];
      for (const [m, p, b] of cases) {
        const res = await call(m, p, admin.cookie, b);
        expect([m, p, res.status, res.body.error]).toEqual([m, p, 404, 'Nutzer nicht gefunden']);
      }
    });
  });

  describe('reset link, totp reset, sessions', () => {
    it('creates reset link and revokes older ones', async () => {
      const admin = await loginAs('admin');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      await createAuthToken({ kind: 'password_reset', userId: bob.id, ttlMs: 3600000 });
      const res = await call('post', `/api/users/${bob.id}/password-reset-link`, admin.cookie);
      expect(res.status).toBe(200);
      expect(res.body.link).toMatch(/^https:\/\/test\.example\/#reset\/[A-Za-z0-9_-]+$/);
      const { rows } = await pool.query(`SELECT used_at FROM auth_tokens WHERE kind = 'password_reset' AND user_id = $1`, [bob.id]);
      expect(rows.filter((r) => r.used_at === null)).toHaveLength(1);
      expect((await waitForAudit('user.password_reset_link')).length).toBe(1);
    });

    it('409 for inactive user', async () => {
      const admin = await loginAs('admin');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      await pool.query('UPDATE users SET is_active = false WHERE id = $1', [bob.id]);
      expect((await call('post', `/api/users/${bob.id}/password-reset-link`, admin.cookie)).status).toBe(409);
    });

    it('resets totp state and recovery codes', async () => {
      const admin = await loginAs('admin');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      await pool.query(
        `UPDATE users SET totp_secret_enc = 's', totp_pending_enc = 'p', totp_enabled_at = now(), totp_last_step = 5 WHERE id = $1`,
        [bob.id]
      );
      await pool.query(`INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, 'h')`, [bob.id]);
      const res = await call('post', `/api/users/${bob.id}/totp/reset`, admin.cookie);
      expect(res.status).toBe(204);
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [bob.id]);
      expect(rows[0]).toMatchObject({ totp_secret_enc: null, totp_pending_enc: null, totp_enabled_at: null, totp_last_step: null });
      const codes = await pool.query('SELECT 1 FROM user_recovery_codes WHERE user_id = $1', [bob.id]);
      expect(codes.rowCount).toBe(0);
      expect((await waitForAudit('auth.totp_reset')).length).toBe(1);
    });

    it('revokes all sessions', async () => {
      const admin = await loginAs('admin');
      const bob = await createUser(pool, { email: 'bob@firma.de', name: 'Bob', passwordHash: 'x', role: 'user' });
      const bobCookie = await sessionFor(bob);
      const res = await call('delete', `/api/users/${bob.id}/sessions`, admin.cookie);
      expect(res.status).toBe(204);
      expect((await call('get', '/api/plan', bobCookie)).status).toBe(401);
      expect((await waitForAudit('user.sessions_revoked')).length).toBe(1);
    });
  });
});
