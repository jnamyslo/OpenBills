import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
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
