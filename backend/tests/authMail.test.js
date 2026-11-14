import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.fn().mockResolvedValue({});
const platformSendMail = vi.fn().mockResolvedValue({});
const queryMock = vi.fn();
const route = { system: 'own' };
const createTransporter = vi.fn(async () => ({ sendMail }));

vi.mock('../services/emailService.js', () => ({
  createTransporter: (...a) => createTransporter(...a),
  getSenderInfo: vi.fn(async () => ({ email: 'from@x.de', name: 'OpenBills' })),
  escapeHtml: (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
}));
vi.mock('../database.js', () => ({ query: (...a) => queryMock(...a) }));
vi.mock('../services/mailRouting.js', () => ({
  getMailRoute: vi.fn(async (kind) => route[kind]),
  createPlatformTransporter: vi.fn(() => ({ sendMail: platformSendMail })),
  PLATFORM_SYSTEM_SENDER: { name: 'OpenBills', email: 'support@openbills.de' },
}));

const { sendInviteMail, sendPasswordResetMail, isSmtpConfigured } = await import('../services/authMailService.js');

describe('Auth-Mails', () => {
  beforeEach(() => {
    sendMail.mockClear(); platformSendMail.mockClear(); createTransporter.mockClear();
    queryMock.mockReset(); delete process.env.SMTP_HOST; route.system = 'own';
  });

  it('sendPasswordResetMail', async () => {
    await sendPasswordResetMail('a@b.de', { link: 'https://x/#reset/t' });
    const m = sendMail.mock.calls[0][0];
    expect(m.to).toBe('a@b.de');
    expect(m.subject).toBe('Passwort zurücksetzen – OpenBills');
    expect(m.text).toContain('https://x/#reset/t');
    expect(m.text).toContain('1 Stunde');
    expect(m.from).toContain('from@x.de');
  });

  it('sendInviteMail escaped HTML', async () => {
    await sendInviteMail('a@b.de', { link: 'https://x/#invite/t?a=1&b="2"', inviterName: '<b>Max</b>' });
    const m = sendMail.mock.calls[0][0];
    expect(m.subject).toBe('Einladung zu OpenBills');
    expect(m.text).toContain('48 Stunden');
    expect(m.html).toContain('&lt;b&gt;Max&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Max</b>');
    expect(m.html).toContain('&amp;b=&quot;2&quot;');
  });

  it('isSmtpConfigured', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ smtp_host: 'h' }] });
    expect(await isSmtpConfigured()).toBe(true);
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await isSmtpConfigured()).toBe(false);
    process.env.SMTP_HOST = 'smtp';
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await isSmtpConfigured()).toBe(true);
    queryMock.mockRejectedValueOnce(new Error('db'));
    expect(await isSmtpConfigured()).toBe(true);
    delete process.env.SMTP_HOST;
    queryMock.mockRejectedValueOnce(new Error('db'));
    expect(await isSmtpConfigured()).toBe(false);
  });

  it('Plattform-Route: Absender support@openbills.de über den Plattform-Relay', async () => {
    route.system = 'platform';
    await sendPasswordResetMail('a@b.de', { link: 'https://x/#reset/t' });
    expect(createTransporter).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(platformSendMail.mock.calls[0][0].from).toBe('"OpenBills" <support@openbills.de>');
  });

  it('Plattform-Route: isSmtpConfigured ist true ohne DB-Abfrage', async () => {
    route.system = 'platform';
    expect(await isSmtpConfigured()).toBe(true);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('Einladung im Rechnungsmail-Layout mit Firmenfarbe und Button', async () => {
    queryMock.mockResolvedValue({ rows: [{ name: 'Muster GmbH', primary_color: '#123456', secondary_color: '#654321' }] });
    await sendInviteMail('a@b.de', { link: 'https://x/#invite/t?a=1&b=2', inviterName: 'Max' });
    const { html, text } = sendMail.mock.calls[0][0];
    expect(html).toContain('linear-gradient(135deg, #123456 0%, #654321 100%)');
    expect(html).toContain('Passwort festlegen');
    expect(html.split('https://x/#invite/t?a=1&amp;b=2').length - 1).toBe(2);
    expect(html).toContain('Muster GmbH');
    expect(html).toContain('Versendet über OpenBills');
    expect(text).toContain('https://x/#invite/t?a=1&b=2');
  });

  it('Reset ohne Firmendaten nutzt OpenBills-Defaults', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sendPasswordResetMail('a@b.de', { link: 'https://x/#reset/t' });
    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('#2563eb');
    expect(html).toContain('Neues Passwort festlegen');
    expect(html).toContain('1 Stunde');
  });

  it('Firmenfarbe mit Fremdinhalt wird nicht ins CSS übernommen', async () => {
    queryMock.mockResolvedValue({ rows: [{ name: 'X', primary_color: 'red;}</style><script>', secondary_color: null }] });
    await sendPasswordResetMail('a@b.de', { link: 'https://x/#reset/t' });
    const { html } = sendMail.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('#2563eb');
  });
});

