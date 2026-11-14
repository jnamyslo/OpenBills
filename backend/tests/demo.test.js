import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { ORIGIN, loginAs } from './helpers/auth.js';
import { createUser } from '../auth/users.js';
import { hashPassword } from '../auth/password.js';
import { demoGuard } from '../demo/guard.js';
import { createTransporter } from '../services/emailService.js';
import { createPlatformTransporter } from '../services/mailRouting.js';
import { scheduleDemoResets } from '../demo/reset.js';
import { createApp } from '../app.js';
import { PUBLIC_API_PATHS } from '../auth/middleware.js';
import { isDemoMode, assertDemoConfig, nextResetAt, DEMO_EMAIL, DEMO_PASSWORD } from '../demo/index.js';

afterEach(() => vi.unstubAllEnvs());

describe('isDemoMode', () => {
  it('nur exakt "true" (getrimmt) aktiviert', () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    expect(isDemoMode()).toBe(true);
    vi.stubEnv('OPENBILLS_DEMO', ' true ');
    expect(isDemoMode()).toBe(true);
    for (const v of ['', '1', 'false', 'TRUE ', 'yes']) {
      vi.stubEnv('OPENBILLS_DEMO', v);
      expect(isDemoMode(), v).toBe(false);
    }
  });
});

describe('assertDemoConfig', () => {
  it('Demo + Tarif schließen sich aus', () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    expect(() => assertDemoConfig()).toThrow('OPENBILLS_DEMO und OPENBILLS_PLAN schließen sich aus');
  });

  it('Demo ohne Tarif und Tarif ohne Demo sind ok', () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    vi.stubEnv('OPENBILLS_PLAN', '');
    expect(() => assertDemoConfig()).not.toThrow();
    vi.stubEnv('OPENBILLS_DEMO', '');
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    expect(() => assertDemoConfig()).not.toThrow();
  });
});

describe('nextResetAt', () => {
  it('nächste volle Stunde mit hour % 3 === 0, strikt danach', () => {
    expect(nextResetAt(new Date(2026, 10, 14, 21, 59))).toEqual(new Date(2026, 10, 15, 0, 0));
    expect(nextResetAt(new Date(2026, 10, 14, 3, 0, 0))).toEqual(new Date(2026, 10, 14, 6, 0));
    expect(nextResetAt(new Date(2026, 10, 14, 4, 30))).toEqual(new Date(2026, 10, 14, 6, 0));
    expect(nextResetAt(new Date(2026, 10, 14, 2, 59, 59, 999))).toEqual(new Date(2026, 10, 14, 3, 0));
  });
});

describe('GET /api/demo', () => {
  const app = createApp();

  it('ist öffentlich', () => {
    expect(PUBLIC_API_PATHS.some((p) => p.method === 'GET' && p.pattern.test('/demo'))).toBe(true);
    expect(PUBLIC_API_PATHS.some((p) => p.method === 'GET' && p.pattern.test('/demo/x'))).toBe(false);
  });

  it('ohne Demo-Modus nur { demo: false }', async () => {
    vi.stubEnv('OPENBILLS_DEMO', '');
    const res = await request(app).get('/api/demo');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demo: false });
  });

  it('im Demo-Modus mit Zugangsdaten und nächstem Reset', async () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    const res = await request(app).get('/api/demo');
    expect(res.status).toBe(200);
    expect(res.body.demo).toBe(true);
    expect(res.body.email).toBe(DEMO_EMAIL);
    expect(res.body.password).toBe(DEMO_PASSWORD);
    expect(new Date(res.body.nextResetAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('demoGuard', () => {
  const run = (method, path) => {
    let status = null;
    let body = null;
    let nextCalled = false;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    demoGuard({ method, path }, res, () => { nextCalled = true; });
    return { status, body, nextCalled };
  };

  const BLOCKED = [
    ['POST', '/auth/password'],
    ['POST', '/auth/totp/setup'],
    ['POST', '/auth/totp/enable'],
    ['POST', '/auth/totp/disable'],
    ['POST', '/auth/password-reset/request'],
    ['POST', '/auth/password-reset/abc_-1'],
    ['POST', '/auth/setup'],
    ['POST', '/auth/invite/abc'],
    ['POST', '/users/invite'],
    ['PUT', '/users/5'],
    ['POST', '/users/5/password-reset-link'],
    ['POST', '/users/5/totp/reset'],
    ['POST', '/users/5/unlock'],
    ['DELETE', '/users/5/sessions'],
    ['POST', '/backup/restore-zip'],
    ['DELETE', '/backup/delete/vollbackup_2026.zip'],
    ['POST', '/email-management/smtp-settings'],
    ['POST', '/email-management/debug-config'],
    ['POST', '/email-management/diagnose-smtp'],
    ['POST', '/email-management/test-smtp'],
    ['POST', '/email-management/test-network'],
    ['POST', '/email-management/send-test-email'],
  ];

  it('sperrt die Liste im Demo-Modus mit 403 DEMO_DISABLED', () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    for (const [method, path] of BLOCKED) {
      const r = run(method, path);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body).toEqual({ error: 'In der Demo deaktiviert', code: 'DEMO_DISABLED' });
      expect(r.nextCalled).toBe(false);
    }
  });

  it('lässt normale Arbeit im Demo-Modus durch', () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    for (const [method, path] of [
      ['POST', '/invoices'],
      ['PUT', '/company/1'],
      ['POST', '/backup/create-zip'],
      ['POST', '/email/send-invoice'],
      ['POST', '/auth/login'],
      ['POST', '/auth/logout'],
      ['GET', '/users'],
    ]) {
      expect(run(method, path).nextCalled, `${method} ${path}`).toBe(true);
    }
  });

  it('lässt sich nicht per Schrägstrich, Großschreibung oder // umgehen', () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    for (const [method, path] of [
      ['POST', '/auth/password/'],
      ['POST', '/AUTH/Password'],
      ['POST', '/auth//password'],
      ['POST', '/auth/totp/enable/'],
      ['POST', '/email-management/smtp-settings/'],
      ['POST', '/Email-Management/test-network'],
      ['POST', '/backup/restore-zip/'],
      ['POST', '/users//invite'],
    ]) {
      expect(run(method, path).status, `${method} ${path}`).toBe(403);
    }
  });

  it('ist ohne Demo-Modus inaktiv', () => {
    vi.stubEnv('OPENBILLS_DEMO', '');
    for (const [method, path] of BLOCKED) expect(run(method, path).nextCalled).toBe(true);
  });
});

describe('Mail-Abfang', () => {
  it('Demo-Modus: beide Transport-Fabriken liefern jsonTransport', async () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    expect((await createTransporter()).options.jsonTransport).toBe(true);
    expect(createPlatformTransporter().options.jsonTransport).toBe(true);
  });

  it('Demo-Transport versendet nicht, liefert aber eine messageId', async () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    const info = await (await createTransporter()).sendMail({ from: 'a@example.com', to: 'b@example.com', subject: 'x', text: 'y' });
    expect(info.messageId).toBeTruthy();
  });

  it('ohne Demo-Modus echter Plattform-Transport', () => {
    vi.stubEnv('OPENBILLS_DEMO', '');
    vi.stubEnv('PLATFORM_SMTP_HOST', 'smtp.example.com');
    const t = createPlatformTransporter();
    expect(t.options.jsonTransport).toBeUndefined();
    expect(t.options.host).toBe('smtp.example.com');
  });

  it('nodemailer.createTransport nur in den Fabriken bzw. gesperrten Test-Routen', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('..', import.meta.url).pathname;
    const hits = [];
    for (const dir of ['services', 'routes', 'utils', 'auth', 'scripts', 'demo']) {
      for (const f of readdirSync(join(root, dir))) {
        if (!f.endsWith('.js')) continue;
        if (readFileSync(join(root, dir, f), 'utf8').includes('nodemailer.createTransport(')) hits.push(`${dir}/${f}`);
      }
    }
    // emailManagement.js: nur test-smtp/send-test-email – im Demo-Modus per demoGuard gesperrt.
    expect(hits.sort()).toEqual(['demo/index.js', 'routes/emailManagement.js', 'services/emailService.js', 'services/mailRouting.js']);
  });
});

describe.skipIf(!hasDb)('Demo-User: keine Kontosperre', () => {
  const app = createApp();

  beforeAll(migrateTestDb);
  beforeEach(resetAuthTables);

  it('Fehlversuche sperren den Demo-User nicht', async () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    const user = await createUser(pool, { email: DEMO_EMAIL, name: 'Demo', passwordHash: await hashPassword(DEMO_PASSWORD), role: 'admin' });
    await pool.query('UPDATE users SET failed_login_count = 9 WHERE id = $1', [user.id]);

    const bad = await request(app).post('/api/auth/login').set(ORIGIN).send({ email: DEMO_EMAIL, password: 'falsch' });
    expect(bad.status).toBe(401);
    const { rows } = await pool.query('SELECT locked_until FROM users WHERE id = $1', [user.id]);
    expect(rows[0].locked_until).toBeNull();

    const ok = await request(app).post('/api/auth/login').set(ORIGIN).send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('ohne Demo-Modus greift die Sperre weiterhin', async () => {
    vi.stubEnv('OPENBILLS_DEMO', '');
    const user = await createUser(pool, { email: DEMO_EMAIL, name: 'Demo', passwordHash: await hashPassword(DEMO_PASSWORD), role: 'admin' });
    await pool.query('UPDATE users SET failed_login_count = 9 WHERE id = $1', [user.id]);
    await request(app).post('/api/auth/login').set(ORIGIN).send({ email: DEMO_EMAIL, password: 'falsch' });
    const { rows } = await pool.query('SELECT locked_until FROM users WHERE id = $1', [user.id]);
    expect(rows[0].locked_until).not.toBeNull();
  });
});

describe.skipIf(!hasDb)('Demo-Sperre über echte Express-Routen', () => {
  const app = createApp();

  beforeAll(migrateTestDb);
  beforeEach(resetAuthTables);

  it('Pfad-Varianten erreichen die Handler nicht', async () => {
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    const { cookie } = await loginAs('admin');
    for (const path of [
      '/api/auth/password/',
      '/api/AUTH/Password',
      '/api/email-management/test-network/',
      '/api/EMAIL-MANAGEMENT/send-test-email',
      '/api/users/1/unlock/',
    ]) {
      const res = await request(app).post(path).set(ORIGIN).set('Cookie', cookie).send({});
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe('DEMO_DISABLED');
    }
  });
});

afterAll(async () => {
  if (hasDb) await pool.end();
});

describe('scheduleDemoResets', () => {
  it('wiederholt einen fehlgeschlagenen Reset nach einer Minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 2, 59, 0));
    vi.stubEnv('OPENBILLS_DEMO', 'true');
    const reset = vi.fn().mockRejectedValueOnce(new Error('deadlock')).mockResolvedValue(undefined);
    scheduleDemoResets({ reset });
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(reset).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(reset).toHaveBeenCalledTimes(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
