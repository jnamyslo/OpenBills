import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  resolvePlanName, getPlanName, getUpgradeContact, getLimit, hasFeature, currentPeriod, requireFeature, PlanError,
} from '../utils/plan.js';
import { countReleaseIfNeeded } from '../services/quotaService.js';

afterEach(() => vi.unstubAllEnvs());

describe('resolvePlanName', () => {
  it('leer oder fehlend = selfhosted', () => {
    expect(resolvePlanName(undefined)).toBe('selfhosted');
    expect(resolvePlanName('')).toBe('selfhosted');
    expect(resolvePlanName('  ')).toBe('selfhosted');
  });

  it('akzeptiert Tiers unabhängig von Groß-/Kleinschreibung', () => {
    expect(resolvePlanName('Starter')).toBe('starter');
    expect(resolvePlanName(' professional ')).toBe('professional');
  });

  it('wirft bei Tippfehlern und bei explizitem selfhosted', () => {
    expect(() => resolvePlanName('profesional')).toThrow(/Unbekannter OPENBILLS_PLAN/);
    expect(() => resolvePlanName('selfhosted')).toThrow();
  });
});

describe('Limits und Features', () => {
  it('ignoriert den alten BELEGO_PLAN', () => {
    vi.stubEnv('OPENBILLS_PLAN', '');
    vi.stubEnv('BELEGO_PLAN', 'free');
    expect(getPlanName()).toBe('selfhosted');
  });

  it('liest den Upgrade-Kontakt aus OPENBILLS_UPGRADE_CONTACT', () => {
    vi.stubEnv('OPENBILLS_UPGRADE_CONTACT', 'vertrieb@openbills.de');
    expect(getUpgradeContact()).toBe('vertrieb@openbills.de');
  });

  it('selfhosted ist unbegrenzt mit allen Features', () => {
    vi.stubEnv('OPENBILLS_PLAN', '');
    expect(getLimit('invoices')).toBeNull();
    expect(getLimit('customers')).toBeNull();
    expect(hasFeature('jobs')).toBe(true);
  });

  it('Matrix laut Spec', () => {
    const expected = {
      free: [5, 5, 10], starter: [25, 25, 50], professional: [100, 100, 250], enterprise: [null, null, null],
    };
    for (const [plan, [inv, quo, cust]] of Object.entries(expected)) {
      vi.stubEnv('OPENBILLS_PLAN', plan);
      expect([getLimit('invoices'), getLimit('quotes'), getLimit('customers')]).toEqual([inv, quo, cust]);
    }
  });

  it('Feature-Verteilung', () => {
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    expect(hasFeature('email')).toBe(false);
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    expect(hasFeature('email')).toBe(true);
    expect(hasFeature('reminders')).toBe(true);
    expect(hasFeature('jobs')).toBe(false);
    expect(hasFeature('reportingFull')).toBe(false);
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    expect(hasFeature('jobs')).toBe(true);
    expect(hasFeature('customerPricing')).toBe(true);
  });
});

describe('Mail-Features', () => {
  it.each([
    ['', true, true], ['enterprise', true, true], ['professional', true, false],
    ['starter', false, false], ['free', false, false],
  ])('Plan "%s": ownSmtp=%s ownSystemSmtp=%s', (plan, own, ownSystem) => {
    vi.stubEnv('OPENBILLS_PLAN', plan);
    expect(hasFeature('ownSmtp')).toBe(own);
    expect(hasFeature('ownSystemSmtp')).toBe(ownSystem);
  });
});

describe('currentPeriod', () => {
  it('nutzt deutsche Zeit am Monatswechsel', () => {
    // 31.10. 23:30 UTC = 01.11. 00:30 in Berlin (MEZ)
    expect(currentPeriod(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
    expect(currentPeriod(new Date('2026-11-13T12:00:00Z'))).toBe('2026-11');
  });
});

describe('requireFeature', () => {
  const run = (mw, method) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    mw({ method }, res, next);
    return { res, next };
  };

  it('blockiert fehlendes Feature mit 403', () => {
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    const { res, next } = run(requireFeature('jobs'), 'POST');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].code).toBe('FEATURE_NOT_IN_PLAN');
  });

  it('allowRead lässt GET durch, blockiert Schreiben', () => {
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    expect(run(requireFeature('jobs', { allowRead: true }), 'GET').next).toHaveBeenCalled();
    expect(run(requireFeature('jobs', { allowRead: true }), 'PUT').next).not.toHaveBeenCalled();
  });
});

/** Minimaler In-Memory-Client für die SQL-Aufrufe in countReleaseIfNeeded. */
function fakeClient({ countedAt = null, used = 0 } = {}) {
  const state = { countedAt, used, updates: 0 };
  const client = {
    state,
    query: vi.fn(async (sql) => {
      if (sql.startsWith('SELECT quota_counted_at')) return { rows: [{ quota_counted_at: state.countedAt }] };
      if (sql.startsWith('SELECT count')) return { rows: [{ count: state.used }] };
      if (sql.startsWith('UPDATE usage_counters')) { state.used += 1; return { rows: [] }; }
      if (sql.includes('SET quota_counted_at')) { state.countedAt = new Date(); state.updates += 1; return { rows: [] }; }
      return { rows: [] };
    }),
  };
  return client;
}

describe('countReleaseIfNeeded', () => {
  it('Entwurf zählt nicht', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    const client = fakeClient();
    await countReleaseIfNeeded(client, 'invoices', 'id', 'draft');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('Freigabe zählt einmal', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    const client = fakeClient();
    await countReleaseIfNeeded(client, 'invoices', 'id', 'sent');
    await countReleaseIfNeeded(client, 'invoices', 'id', 'paid');
    expect(client.state.used).toBe(1);
    expect(client.state.updates).toBe(1);
  });

  it('wirft 402 am Limit und zählt nicht weiter', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    const client = fakeClient({ used: 5 });
    const error = await countReleaseIfNeeded(client, 'quotes', 'id', 'sent').catch(e => e);
    expect(error).toBeInstanceOf(PlanError);
    expect(error.statusCode).toBe(402);
    expect(error.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', kind: 'quotes', limit: 5 });
    expect(client.state.used).toBe(5);
  });

  it('selfhosted zählt ohne Limit', async () => {
    vi.stubEnv('OPENBILLS_PLAN', '');
    const client = fakeClient({ used: 10_000 });
    await countReleaseIfNeeded(client, 'invoices', 'id', 'sent');
    expect(client.state.used).toBe(10_001);
  });
});
