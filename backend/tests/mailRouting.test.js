import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
const createTransport = vi.fn(() => ({ sendMail: vi.fn() }));

vi.mock('../database.js', () => ({ query: (...a) => queryMock(...a) }));
vi.mock('nodemailer', () => ({ default: { createTransport: (...a) => createTransport(...a) } }));

const {
  getMailRoute, assertPlatformMailConfig, createPlatformTransporter, getPlatformInstanceSender,
} = await import('../services/mailRouting.js');

const ownSmtpRow = { rows: [{ smtp_host: 'mail.kunde.de' }] };

function stubPlatformEnv(overrides = {}) {
  const env = {
    PLATFORM_SMTP_HOST: 'smtp-relay.brevo.com',
    PLATFORM_SMTP_USER: 'brevo-user',
    PLATFORM_SMTP_PASS: 'brevo-key',
    OPENBILLS_INSTANCE: 'muster',
    ...overrides,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

beforeEach(() => {
  queryMock.mockReset();
  createTransport.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('getMailRoute', () => {
  it.each([
    ['', true, 'own', 'own'],
    ['enterprise', false, 'own', 'own'],
    ['professional', true, 'platform', 'own'],
    ['professional', false, 'platform', 'platform'],
    ['starter', true, 'platform', 'platform'],
    ['free', true, 'platform', 'platform'],
  ])('Plan "%s" (eigenes SMTP aktiv: %s) → system=%s, customer=%s', async (plan, ownActive, system, customer) => {
    vi.stubEnv('OPENBILLS_PLAN', plan);
    queryMock.mockResolvedValue(ownActive ? ownSmtpRow : { rows: [] });
    expect(await getMailRoute('system')).toBe(system);
    expect(await getMailRoute('customer')).toBe(customer);
  });

  it('Professional mit deaktivierter SMTP-Zeile nutzt die Plattform', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    // Query filtert is_enabled = true → keine Zeile
    queryMock.mockResolvedValue({ rows: [] });
    expect(await getMailRoute('customer')).toBe('platform');
    expect(queryMock.mock.calls[0][0]).toMatch(/is_enabled = true/);
  });

  it('Professional mit leerem smtp_host nutzt die Plattform', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    queryMock.mockResolvedValue({ rows: [{ smtp_host: '' }] });
    expect(await getMailRoute('customer')).toBe('platform');
  });

  it('Professional bei DB-Fehler nutzt die Plattform', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    queryMock.mockRejectedValue(new Error('db'));
    expect(await getMailRoute('customer')).toBe('platform');
  });
});

describe('assertPlatformMailConfig', () => {
  it('selfhosted und enterprise brauchen keine Plattform-Variablen', () => {
    vi.stubEnv('OPENBILLS_PLAN', '');
    expect(() => assertPlatformMailConfig()).not.toThrow();
    vi.stubEnv('OPENBILLS_PLAN', 'enterprise');
    expect(() => assertPlatformMailConfig()).not.toThrow();
  });

  it('starter ohne PLATFORM_SMTP_PASS wirft', () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv({ PLATFORM_SMTP_PASS: '' });
    expect(() => assertPlatformMailConfig()).toThrow(/PLATFORM_SMTP_PASS/);
  });

  it('professional ohne PLATFORM_SMTP_HOST wirft', () => {
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    stubPlatformEnv({ PLATFORM_SMTP_HOST: '' });
    expect(() => assertPlatformMailConfig()).toThrow(/PLATFORM_SMTP_HOST/);
  });

  it.each(['Mein Kunde', 'Muster', '-muster', 'muster-', ''])('starter mit OPENBILLS_INSTANCE "%s" wirft', (name) => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv({ OPENBILLS_INSTANCE: name });
    expect(() => assertPlatformMailConfig()).toThrow(/OPENBILLS_INSTANCE/);
  });

  it('starter vollständig konfiguriert wirft nicht', () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv({ OPENBILLS_INSTANCE: 'muster-gmbh-2' });
    expect(() => assertPlatformMailConfig()).not.toThrow();
  });
});

describe('Plattform-Transport und Absender', () => {
  it('createPlatformTransporter nutzt PLATFORM_SMTP_* mit Port-Default 587', () => {
    stubPlatformEnv();
    createPlatformTransporter();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: 'brevo-user', pass: 'brevo-key' },
    }));
  });

  it('createPlatformTransporter übernimmt Port und secure', () => {
    stubPlatformEnv({ PLATFORM_SMTP_PORT: '465', PLATFORM_SMTP_SECURE: 'true' });
    createPlatformTransporter();
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true }));
  });

  it('getPlatformInstanceSender', () => {
    stubPlatformEnv();
    expect(getPlatformInstanceSender()).toBe('muster@openbills.de');
  });
});

describe('enforcePlatformMailLimit', () => {
  const run = async (method = 'POST', body = {}) => {
    const { enforcePlatformMailLimit } = await import('../services/mailRouting.js');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await enforcePlatformMailLimit({ method, body }, res, next);
    return { res, next };
  };
  const countSql = () => queryMock.mock.calls.map(c => c[0]).find(sql => sql.includes('email_history'));

  it('Starter mit 20 versendeten Mails heute → 429 PLATFORM_MAIL_LIMIT', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv();
    queryMock.mockResolvedValue({ rows: [{ count: '20' }] });
    const { res, next } = await run();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'PLATFORM_MAIL_LIMIT', limit: 20, plan: 'starter' });
  });

  it('Starter mit 19 Mails → weiter', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv();
    queryMock.mockResolvedValue({ rows: [{ count: '19' }] });
    const { next } = await run();
    expect(next).toHaveBeenCalled();
  });

  it('zählt nur erfolgreich versendete Mails mit Plattform-Absender seit Tagesbeginn (Berlin)', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv();
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] });
    await run();
    expect(countSql()).toMatch(/status = 'sent'/);
    expect(countSql()).toMatch(/Europe\/Berlin/);
    const call = queryMock.mock.calls.find(c => c[0].includes('email_history'));
    expect(call[1]).toEqual(['muster@openbills.de']);
  });

  it('Selfhosted → weiter ohne Zählung', async () => {
    vi.stubEnv('OPENBILLS_PLAN', '');
    const { next } = await run();
    expect(next).toHaveBeenCalled();
    expect(countSql()).toBeUndefined();
  });

  it('Professional mit eigenem SMTP → weiter ohne Zählung', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    queryMock.mockResolvedValue(ownSmtpRow);
    const { next } = await run();
    expect(next).toHaveBeenCalled();
    expect(countSql()).toBeUndefined();
  });

  it('GET → weiter ohne Zählung', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    const { next } = await run('GET');
    expect(next).toHaveBeenCalled();
    expect(countSql()).toBeUndefined();
  });

  it('zählt Empfänger: 15 heute + 6 Empfänger im Request → 429', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv();
    queryMock.mockResolvedValue({ rows: [{ count: '15' }] });
    const { res, next } = await run('POST', { customerEmails: ['a@x.de', 'b@x.de', 'c@x.de', 'd@x.de', 'e@x.de', 'f@x.de'] });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('zählt Empfänger: 15 heute + 5 Empfänger → weiter', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv();
    queryMock.mockResolvedValue({ rows: [{ count: '15' }] });
    const { next } = await run('POST', { customerEmails: ['a@x.de', 'b@x.de', 'c@x.de', 'd@x.de', 'e@x.de'] });
    expect(next).toHaveBeenCalled();
  });

  it('Zählung summiert Empfänger pro Historien-Eintrag (kommagetrennt)', async () => {
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    stubPlatformEnv();
    queryMock.mockResolvedValue({ rows: [{ count: '0' }] });
    await run();
    expect(countSql()).toMatch(/string_to_array\(recipient_email, ','\)/);
  });
});

describe('platformInviteLimitReached', () => {
  it('Plattform-Route: 10 heute per Mail versendete Einladungen → erreicht', async () => {
    const { platformInviteLimitReached } = await import('../services/mailRouting.js');
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    queryMock.mockResolvedValue({ rows: [{ count: '10' }] });
    expect(await platformInviteLimitReached()).toBe(true);
    const sql = queryMock.mock.calls.find(c => c[0].includes('audit_log'))[0];
    expect(sql).toMatch(/user\.invited/);
    expect(sql).toMatch(/emailed/);
    expect(sql).toMatch(/Europe\/Berlin/);
  });

  it('Plattform-Route: 9 → nicht erreicht', async () => {
    const { platformInviteLimitReached } = await import('../services/mailRouting.js');
    vi.stubEnv('OPENBILLS_PLAN', 'starter');
    queryMock.mockResolvedValue({ rows: [{ count: '9' }] });
    expect(await platformInviteLimitReached()).toBe(false);
  });

  it('Eigenes SMTP (Enterprise) → nie erreicht, keine Zählung', async () => {
    const { platformInviteLimitReached } = await import('../services/mailRouting.js');
    vi.stubEnv('OPENBILLS_PLAN', 'enterprise');
    expect(await platformInviteLimitReached()).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

