import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';

const app = createApp();

const GATED = ['smtp-settings', 'debug-config', 'diagnose-smtp', 'test-smtp', 'test-network', 'send-test-email'];

describe.skipIf(!hasDb)('SMTP-Verwaltung und Mail-Routen je Tarif (DB)', () => {
  beforeAll(migrateTestDb);
  afterAll(() => pool.end());
  beforeEach(resetAuthTables);
  afterEach(() => vi.unstubAllEnvs());

  it.each(GATED)('Starter: POST /api/email-management/%s -> 403 ownSmtp', async (path) => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    const admin = await loginAs('admin');
    const res = await request(app).post(`/api/email-management/${path}`).set('Cookie', admin.cookie).set(ORIGIN).send({});
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', feature: 'ownSmtp' });
  });

  it('Free: POST /smtp-settings -> 403', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    const admin = await loginAs('admin');
    const res = await request(app).post('/api/email-management/smtp-settings').set('Cookie', admin.cookie).set(ORIGIN).send({});
    expect(res.status).toBe(403);
  });

  it('Starter: GET /smtp-settings bleibt erlaubt', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    const admin = await loginAs('admin');
    const res = await request(app).get('/api/email-management/smtp-settings').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
  });

  it('Professional: POST /smtp-settings ist nicht gesperrt', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    const admin = await loginAs('admin');
    const res = await request(app).post('/api/email-management/smtp-settings').set('Cookie', admin.cookie).set(ORIGIN)
      .send({ is_enabled: false });
    expect(res.status).not.toBe(403);
  });

  it('GET /api/plan liefert mailRoutes', async () => {
    const user = await loginAs('user');
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    let res = await request(app).get('/api/plan').set('Cookie', user.cookie);
    expect(res.body.mailRoutes).toEqual({ system: 'platform', customer: 'platform' });
    vi.stubEnv('OPENBILLS_PLAN', '');
    res = await request(app).get('/api/plan').set('Cookie', user.cookie);
    expect(res.body.mailRoutes).toEqual({ system: 'own', customer: 'own' });
  });
});
