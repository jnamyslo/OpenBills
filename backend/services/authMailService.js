import { query } from '../database.js';
import { createTransporter, getSenderInfo, escapeHtml } from './emailService.js';

export const isSmtpConfigured = async () => {
  try {
    const result = await query('SELECT smtp_host FROM smtp_settings WHERE id = 1 AND is_enabled = true');
    if (result.rows.length > 0 && result.rows[0].smtp_host) return true;
  } catch {
    // DB nicht lesbar: nur Umgebungsvariable prüfen
  }
  return Boolean(process.env.SMTP_HOST);
};

const send = async (to, subject, text, html) => {
  const transporter = await createTransporter();
  const sender = await getSenderInfo();
  await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to,
    subject,
    text,
    html,
  });
};

export const sendInviteMail = async (to, { link, inviterName }) => {
  const text = `Hallo,\n\n${inviterName} hat Sie zu OpenBills eingeladen.\n\nBitte legen Sie über folgenden Link Ihr Passwort fest:\n${link}\n\nDer Link ist 48 Stunden gültig und kann nur einmal verwendet werden.\n`;
  const html = `<p>Hallo,</p><p>${escapeHtml(inviterName)} hat Sie zu OpenBills eingeladen.</p><p>Bitte legen Sie über folgenden Link Ihr Passwort fest:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>Der Link ist 48 Stunden gültig und kann nur einmal verwendet werden.</p>`;
  await send(to, 'Einladung zu OpenBills', text, html);
};

export const sendPasswordResetMail = async (to, { link }) => {
  const text = `Hallo,\n\nfür Ihr OpenBills-Konto wurde das Zurücksetzen des Passworts angefordert.\n\nNeues Passwort festlegen:\n${link}\n\nDer Link ist 1 Stunde gültig und kann nur einmal verwendet werden. Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.\n`;
  const html = `<p>Hallo,</p><p>für Ihr OpenBills-Konto wurde das Zurücksetzen des Passworts angefordert.</p><p>Neues Passwort festlegen:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>Der Link ist 1 Stunde gültig und kann nur einmal verwendet werden. Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.</p>`;
  await send(to, 'Passwort zurücksetzen – OpenBills', text, html);
};
