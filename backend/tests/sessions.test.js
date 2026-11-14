import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { createUser } from '../auth/users.js';
import {
  SESSION_COOKIE, createSession, getSession, completeMfa, deleteSession,
  deleteUserSessions, setSessionCookie, clearSessionCookie, cleanupSessions,
} from '../auth/sessions.js';
import { hashToken } from '../auth/crypto.js';

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!hasDb)('sessions (DB)', () => {
  let user;
  beforeAll(migrateTestDb);
  afterAll(() => pool.end());
  beforeEach(async () => {
    await resetAuthTables();
    user = await createUser(pool, { email: 'a@b.de', name: 'A', passwordHash: 'x', role: 'user' });
  });

  const setCol = (token, col, interval) =>
    pool.query(`UPDATE sessions SET ${col} = now() - interval '${interval}' WHERE id_hash = $1`, [hashToken(token)]);

  it('create -> get liefert Nutzer', async () => {
    const t = await createSession(user.id, { ip: '1.2.3.4', userAgent: 'ua' });
    const r = await getSession(t);
    expect(r.user.id).toBe(user.id);
    expect(r.session.mfa_pending).toBe(false);
    expect(await getSession('unbekannt')).toBeNull();
  });

  it('Idle > 12 h -> null', async () => {
    const t = await createSession(user.id, {});
    await setCol(t, 'last_seen_at', '13 hours');
    expect(await getSession(t)).toBeNull();
  });

  it('absolut > 30 Tage -> null', async () => {
    const t = await createSession(user.id, {});
    await setCol(t, 'created_at', '31 days');
    await setCol(t, 'expires_at', '1 day');
    expect(await getSession(t)).toBeNull();
  });

  it('MFA-pending > 5 min -> null, nach completeMfa gültig', async () => {
    const t = await createSession(user.id, { mfaPending: true });
    expect((await getSession(t)).session.mfa_pending).toBe(true);
    await completeMfa(t);
    await setCol(t, 'created_at', '6 minutes');
    expect((await getSession(t)).session.mfa_pending).toBe(false);
    const t2 = await createSession(user.id, { mfaPending: true });
    await setCol(t2, 'created_at', '6 minutes');
    expect(await getSession(t2)).toBeNull();
  });

  it('Sperre beendet bestehende Sessions nicht', async () => {
    const t = await createSession(user.id, {});
    await pool.query('UPDATE users SET locked_until = now() + interval \'10 minutes\' WHERE id = $1', [user.id]);
    const res = await getSession(t);
    expect(res).not.toBeNull();
    expect(res.user.id).toBe(user.id);
  });

  it('inaktiver Nutzer -> null', async () => {
    const t = await createSession(user.id, {});
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);
    expect(await getSession(t)).toBeNull();
  });

  it('last_seen_at wird höchstens einmal pro Minute aktualisiert', async () => {
    const t = await createSession(user.id, {});
    const seen = async () => (await pool.query('SELECT last_seen_at FROM sessions WHERE id_hash = $1', [hashToken(t)])).rows[0].last_seen_at.getTime();
    const first = await seen();
    await getSession(t);
    expect(await seen()).toBe(first);
    await setCol(t, 'last_seen_at', '2 minutes');
    await getSession(t);
    expect(await seen()).toBeGreaterThan(Date.now() - 5000);
  });

  it('deleteSession und deleteUserSessions mit exceptToken', async () => {
    const t1 = await createSession(user.id, {});
    const t2 = await createSession(user.id, {});
    await deleteUserSessions(user.id, { exceptToken: t1 });
    expect(await getSession(t1)).not.toBeNull();
    expect(await getSession(t2)).toBeNull();
    await deleteSession(t1);
    expect(await getSession(t1)).toBeNull();
    const t3 = await createSession(user.id, {});
    await deleteUserSessions(user.id);
    expect(await getSession(t3)).toBeNull();
  });

  it('cleanupSessions löscht abgelaufene, idle und stale MFA-Sessions', async () => {
    const ok = await createSession(user.id, {});
    const idle = await createSession(user.id, {});
    const old = await createSession(user.id, {});
    const mfa = await createSession(user.id, { mfaPending: true });
    await setCol(idle, 'last_seen_at', '13 hours');
    await setCol(old, 'expires_at', '1 minute');
    await setCol(mfa, 'created_at', '6 minutes');
    await cleanupSessions();
    const { rows } = await pool.query('SELECT id_hash FROM sessions');
    expect(rows.map((r) => r.id_hash)).toEqual([hashToken(ok)]);
  });
});

describe('Session-Cookie', () => {
  const orig = process.env.PUBLIC_URL;
  afterEach(() => { process.env.PUBLIC_URL = orig; });
  const fakeRes = () => {
    const res = { calls: [] };
    res.cookie = (...a) => res.calls.push(['cookie', ...a]);
    res.clearCookie = (...a) => res.calls.push(['clear', ...a]);
    return res;
  };

  it('setSessionCookie mit https', () => {
    process.env.PUBLIC_URL = 'https://rechnung.example.de';
    const res = fakeRes();
    setSessionCookie(res, 'tok');
    expect(res.calls[0]).toEqual(['cookie', SESSION_COOKIE, 'tok',
      { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 30 * DAY }]);
  });

  it('http -> nicht secure; clearSessionCookie nutzt gleiche Optionen', () => {
    process.env.PUBLIC_URL = 'http://localhost';
    const res = fakeRes();
    clearSessionCookie(res);
    expect(res.calls[0]).toEqual(['clear', SESSION_COOKIE,
      { httpOnly: true, sameSite: 'lax', secure: false, path: '/' }]);
  });
});
