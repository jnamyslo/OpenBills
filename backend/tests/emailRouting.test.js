import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1', response: '250 OK' });
const createTransport = vi.fn(() => ({ sendMail }));
let db;

vi.mock('nodemailer', () => ({ default: { createTransport: (...a) => createTransport(...a) } }));
vi.mock('../database.js', () => ({
  query: async (sql) => {
    if (sql.includes('FROM company')) return { rows: db.company ? [db.company] : [] };
    if (sql.includes('FROM smtp_settings')) return { rows: db.smtp ? [db.smtp] : [] };
    return { rows: [{ id: 'h1' }] };
  },
}));

const { createTransporter, getSenderInfo, sendQuoteEmail } = await import('../services/emailService.js');

const ownSmtp = {
  smtp_host: 'mail.kunde.de', smtp_port: 587, smtp_secure: false, smtp_user: 'kunde', smtp_pass: null,
  email_from: 'rechnung@kunde.de', email_from_name: 'Kunde',
};

function stubStarter() {
  vi.stubEnv('OPENBILLS_PLAN', 'starter');
  vi.stubEnv('OPENBILLS_INSTANCE', 'muster');
  vi.stubEnv('PLATFORM_SMTP_HOST', 'smtp-relay.brevo.com');
  vi.stubEnv('PLATFORM_SMTP_USER', 'brevo-user');
  vi.stubEnv('PLATFORM_SMTP_PASS', 'brevo-key');
}

beforeEach(() => {
  db = { company: { name: 'Muster GmbH', email: 'info@muster.de' }, smtp: null };
  sendMail.mockClear();
  createTransport.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('Kundenmails – Routing', () => {
  it('Starter: Absender ist <instanz>@openbills.de mit Firmenname und Reply-To', async () => {
    stubStarter();
    expect(await getSenderInfo()).toEqual({ email: 'muster@openbills.de', name: 'Muster GmbH', replyTo: 'info@muster.de' });
  });

  it('Starter ohne Firmendaten: Name OpenBills, kein Reply-To', async () => {
    stubStarter();
    db.company = null;
    expect(await getSenderInfo()).toEqual({ email: 'muster@openbills.de', name: 'OpenBills', replyTo: undefined });
  });

  it('Starter ignoriert eigenes SMTP aus der DB und nutzt den Plattform-Relay', async () => {
    stubStarter();
    db.smtp = ownSmtp;
    await createTransporter();
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport.mock.calls[0][0].host).toBe('smtp-relay.brevo.com');
  });

  it('Professional mit eigenem SMTP nutzt das eigene SMTP', async () => {
    stubStarter();
    vi.stubEnv('OPENBILLS_PLAN', 'professional');
    db.smtp = ownSmtp;
    await createTransporter();
    expect(createTransport.mock.calls[0][0].host).toBe('mail.kunde.de');
    expect((await getSenderInfo()).email).toBe('rechnung@kunde.de');
  });

  it('Selfhosted: eigenes SMTP und Absender ohne Reply-To wie bisher', async () => {
    vi.stubEnv('OPENBILLS_PLAN', '');
    db.smtp = ownSmtp;
    await createTransporter();
    expect(createTransport.mock.calls[0][0].host).toBe('mail.kunde.de');
    expect(await getSenderInfo()).toEqual({ email: 'rechnung@kunde.de', name: 'Kunde' });
  });

  it('sendQuoteEmail unter Starter setzt Plattform-Absender und Reply-To', async () => {
    stubStarter();
    const result = await sendQuoteEmail(['kunde@example.de'], {
      quoteNumber: 'A-1', customerName: 'Kunde', issueDate: '2026-11-14', validUntil: '2026-12-14', total: 10,
      pdfBuffer: Buffer.from('%PDF').toString('base64'),
    }, { name: 'Muster GmbH', primary_color: '#2563eb', secondary_color: '#64748b' });
    expect(result.success).toBe(true);
    const m = sendMail.mock.calls[0][0];
    expect(m.from).toContain('muster@openbills.de');
    expect(m.replyTo).toBe('info@muster.de');
  });
});
