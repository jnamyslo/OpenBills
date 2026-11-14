import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { ORIGIN, loginAs } from './helpers/auth.js';

const { createApp } = await import('../app.js');
const app = createApp();

const call = (method, path, cookie, body) => {
  const req = request(app)[method](path).set(ORIGIN).set('Cookie', cookie);
  return body === undefined ? req : req.send(body);
};

describe.skipIf(!hasDb)('Onboarding-Status je Benutzer', () => {
  beforeAll(migrateTestDb);
  beforeEach(resetAuthTables);
  afterAll(() => pool.end());

  it('neue Benutzer starten mit nicht abgeschlossenem Onboarding', async () => {
    const { cookie } = await loginAs('admin');
    const res = await call('get', '/api/auth/me', cookie);
    expect(res.body.user.onboardingCompleted).toBe(false);
  });

  it('schließt ab und startet erneut – nur für den eigenen Benutzer', async () => {
    const a = await loginAs('admin');
    const b = await loginAs('user');
    const done = await call('post', '/api/auth/onboarding', a.cookie, { completed: true });
    expect(done.status).toBe(200);
    expect(done.body.user.onboardingCompleted).toBe(true);
    expect((await call('get', '/api/auth/me', b.cookie)).body.user.onboardingCompleted).toBe(false);
    const reset = await call('post', '/api/auth/onboarding', a.cookie, { completed: false });
    expect(reset.body.user.onboardingCompleted).toBe(false);
  });

  it('validiert den Body', async () => {
    const { cookie } = await loginAs('admin');
    expect((await call('post', '/api/auth/onboarding', cookie, {})).status).toBe(400);
    expect((await call('post', '/api/auth/onboarding', cookie, { completed: 'yes' })).status).toBe(400);
  });
});
