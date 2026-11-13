import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.fn().mockResolvedValue({});
const queryMock = vi.fn();

vi.mock('../services/emailService.js', () => ({
  createTransporter: vi.fn(async () => ({ sendMail })),
  getSenderInfo: vi.fn(async () => ({ email: 'from@x.de', name: 'OpenBills' })),
  escapeHtml: (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
}));
vi.mock('../database.js', () => ({ query: (...a) => queryMock(...a) }));

const { sendInviteMail, sendPasswordResetMail, isSmtpConfigured } = await import('../services/authMailService.js');

describe('Auth-Mails', () => {
  beforeEach(() => { sendMail.mockClear(); queryMock.mockReset(); delete process.env.SMTP_HOST; });

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
});
