import { query } from '../database.js';
import { createTransporter, getSenderInfo } from './emailService.js';
import { getMailRoute, createPlatformTransporter, PLATFORM_SYSTEM_SENDER } from './mailRouting.js';
import { renderAuthMail } from './authMailLayout.js';

export const isSmtpConfigured = async () => {
  if (await getMailRoute('system') === 'platform') return true;
  try {
    const result = await query('SELECT smtp_host FROM smtp_settings WHERE id = 1 AND is_enabled = true');
    if (result.rows.length > 0 && result.rows[0].smtp_host) return true;
  } catch {
    // DB nicht lesbar: nur Umgebungsvariable prüfen
  }
  return Boolean(process.env.SMTP_HOST);
};

/** Firmenname und -farben für das Mail-Layout; fehlen sie, greifen die Defaults des Layouts. */
const loadBranding = async () => {
  try {
    const result = await query('SELECT name, primary_color, secondary_color FROM company WHERE id = 1');
    const company = result?.rows?.[0];
    if (company) {
      return { companyName: company.name, primaryColor: company.primary_color, secondaryColor: company.secondary_color };
    }
  } catch {
    // ohne Firmendaten mit Defaults senden
  }
  return {};
};

const send = async (to, subject, text, html) => {
  const platform = await getMailRoute('system') === 'platform';
  const transporter = platform ? createPlatformTransporter() : await createTransporter();
  const sender = platform ? PLATFORM_SYSTEM_SENDER : await getSenderInfo();
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
  const html = renderAuthMail({
    heading: 'Einladung zu OpenBills',
    paragraphs: ['Hallo,', `${inviterName} hat Sie zu OpenBills eingeladen. Bitte legen Sie über den folgenden Button Ihr Passwort fest.`],
    buttonLabel: 'Passwort festlegen',
    link,
    note: 'Der Link ist 48 Stunden gültig und kann nur einmal verwendet werden.',
    ...(await loadBranding()),
  });
  await send(to, 'Einladung zu OpenBills', text, html);
};

export const sendPasswordResetMail = async (to, { link }) => {
  const text = `Hallo,\n\nfür Ihr OpenBills-Konto wurde das Zurücksetzen des Passworts angefordert.\n\nNeues Passwort festlegen:\n${link}\n\nDer Link ist 1 Stunde gültig und kann nur einmal verwendet werden. Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.\n`;
  const html = renderAuthMail({
    heading: 'Passwort zurücksetzen',
    paragraphs: ['Hallo,', 'für Ihr OpenBills-Konto wurde das Zurücksetzen des Passworts angefordert.'],
    buttonLabel: 'Neues Passwort festlegen',
    link,
    note: 'Der Link ist 1 Stunde gültig und kann nur einmal verwendet werden. Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.',
    ...(await loadBranding()),
  });
  await send(to, 'Passwort zurücksetzen – OpenBills', text, html);
};
