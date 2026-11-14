import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiService, AuthRequiredError, AUTH_REQUIRED_EVENT, PlanError } from '../api';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api auth handling', () => {
  let target: EventTarget;
  let listener: ReturnType<typeof vi.fn<(event: Event) => void>>;

  beforeEach(() => {
    target = new EventTarget();
    listener = vi.fn<(event: Event) => void>();
    target.addEventListener(AUTH_REQUIRED_EVENT, listener);
    vi.stubGlobal('window', target);
    // Der Logger schreibt fehlgeschlagene Requests nach console.error.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('dispatcht das Event und wirft AuthRequiredError bei 401 AUTH_REQUIRED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'Nicht angemeldet', code: 'AUTH_REQUIRED' })));
    await expect(apiService.getCustomers()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('dispatcht bei 401 MFA_REQUIRED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'x', code: 'MFA_REQUIRED' })));
    await expect(apiService.getCustomers()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('dispatcht nicht für getMe (AuthContext-eigener Aufruf)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'x', code: 'AUTH_REQUIRED' })));
    await expect(apiService.getMe()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(listener).not.toHaveBeenCalled();
  });

  it('meldet 403 FORBIDDEN als "Keine Berechtigung"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { error: 'Keine Berechtigung', code: 'FORBIDDEN' })));
    await expect(apiService.getUsers()).rejects.toThrow('Keine Berechtigung');
    expect(listener).not.toHaveBeenCalled();
  });

  it('gibt die Servermeldung bei 429 weiter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(429, { error: 'Zu viele Versuche. Bitte später erneut versuchen.', code: 'RATE_LIMITED' })));
    await expect(apiService.login('a@example.com', 'pw')).rejects.toThrow('Zu viele Versuche. Bitte später erneut versuchen.');
  });

  it('lässt PlanError unverändert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(402, { error: 'Limit', code: 'PLAN_LIMIT_REACHED', plan: 'free', upgradeContact: null })));
    await expect(apiService.getCustomers()).rejects.toBeInstanceOf(PlanError);
  });

  it('prüft auch direkte fetch-Aufrufe auf 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'x', code: 'AUTH_REQUIRED' })));
    await expect(apiService.generateInvoiceJournalPDF()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('liefert undefined bei 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiService.logout()).resolves.toBeUndefined();
  });

  it('baut die CSV-URL mit Filtern', () => {
    expect(apiService.auditLogCsvUrl({ from: '2026-11-01', action: 'auth.' }))
      .toBe('/api/audit-log?from=2026-11-01&action=auth.&format=csv');
  });
});
