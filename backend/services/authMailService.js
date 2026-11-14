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

const ONBOARDING_STEPS = [
  'Admin-Konto anlegen',
  'Firmendaten in den Einstellungen hinterlegen',
  'Zwei-Faktor-Anmeldung aktivieren',
  'Mitarbeitende einladen',
  'Erste Rechnung schreiben',
];

const onboardingPlanSentence = (plan, instanceSender) => {
  const starter = `E-Mails an Ihre Kunden gehen von ${instanceSender} raus, Antworten landen bei Ihrer Firmen-E-Mail; bis zu 20 Mails pro Tag.`;
  switch (plan) {
    case 'free':
      return 'Rechnungen per E-Mail versenden ist ab Starter enthalten.';
    case 'starter':
      return starter;
    case 'professional':
      return `${starter} Sie können in den Einstellungen einen eigenen Mailserver hinterlegen.`;
    case 'enterprise':
      return 'Bitte hinterlegen Sie in den Einstellungen Ihren eigenen Mailserver; darüber laufen alle Mails.';
    default:
      return '';
  }
};

/** Willkommensmail mit Setup-Link; geht immer über den Plattform-Relay (Firma/SMTP existieren noch nicht). */
export const sendOnboardingMail = async (to, { link, plan, instanceSender }) => {
  const note = 'Der Link ist 48 Stunden gültig und kann nur einmal verwendet werden.';
  const planSentence = onboardingPlanSentence(plan, instanceSender);
  const intro = 'Ihre OpenBills-Instanz ist bereit. Richten Sie über den folgenden Button Ihr Konto ein.';
  const closing = 'Fragen? support@openbills.de';
  const text = [
    'Hallo,',
    intro.replace('über den folgenden Button', 'über folgenden Link'),
    `Konto einrichten:\n${link}`,
    `So starten Sie:\n${ONBOARDING_STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    planSentence,
    note,
    closing,
  ].filter(Boolean).join('\n\n') + '\n';
  const html = renderAuthMail({
    heading: 'Willkommen bei OpenBills',
    paragraphs: [
      'Hallo,',
      intro,
      `So starten Sie: ${ONBOARDING_STEPS.map((s, i) => `${i + 1}. ${s}`).join(' ')}`,
      planSentence,
      closing,
    ].filter(Boolean),
    buttonLabel: 'Konto einrichten',
    link,
    note,
  });
  const transporter = createPlatformTransporter();
  await transporter.sendMail({
    from: `"${PLATFORM_SYSTEM_SENDER.name}" <${PLATFORM_SYSTEM_SENDER.email}>`,
    to,
    subject: 'Willkommen bei OpenBills – Konto einrichten',
    text,
    html,
  });
};
