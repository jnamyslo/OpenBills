/**
 * Mail-Routing für Hosted-Tarife: entscheidet pro Mailart, ob über den Plattform-Relay
 * (PLATFORM_SMTP_* aus .env.platform) oder das eigene SMTP der Instanz versendet wird.
 * Siehe docs/superpowers/specs/2026-11-14-platform-mail-design.md
 */
import nodemailer from 'nodemailer';
import { isDemoMode, createDemoTransporter } from '../demo/index.js';
import { query } from '../database.js';
import { hasFeature, getPlanName, getUpgradeContact, PlanError, sendPlanError } from '../utils/plan.js';

export const PLATFORM_DOMAIN = 'openbills.de';
export const PLATFORM_SYSTEM_SENDER = { name: 'OpenBills', email: `support@${PLATFORM_DOMAIN}` };

const INSTANCE_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** true für free/starter/professional: Systemmails laufen über die Plattform. */
export function isPlatformInstance() {
  return !hasFeature('ownSystemSmtp');
}

export function getPlatformInstanceSender() {
  return `${(process.env.OPENBILLS_INSTANCE || '').trim()}@${PLATFORM_DOMAIN}`;
}

/** Startprüfung: Plattform-Instanzen dürfen nie ohne Plattform-Zugang laufen (kein stiller Fallback). */
export function assertPlatformMailConfig() {
  if (!isPlatformInstance()) return;
  for (const name of ['PLATFORM_SMTP_HOST', 'PLATFORM_SMTP_USER', 'PLATFORM_SMTP_PASS']) {
    if (!(process.env[name] || '').trim()) {
      throw new Error(`${name} fehlt. Tarife free/starter/professional versenden über den Plattform-Relay – .env.platform anlegen (./deploy-instance.sh fragt die Zugangsdaten ab).`);
    }
  }
  const instance = (process.env.OPENBILLS_INSTANCE || '').trim();
  if (!INSTANCE_NAME_PATTERN.test(instance)) {
    throw new Error(`OPENBILLS_INSTANCE "${instance}" ist ungültig. Erlaubt: Kleinbuchstaben, Ziffern und Bindestrich (nicht am Anfang/Ende), da der Name Teil der Absenderadresse wird.`);
  }
}

export function createPlatformTransporter() {
  if (isDemoMode()) return createDemoTransporter();
  return nodemailer.createTransport({
    host: process.env.PLATFORM_SMTP_HOST,
    port: Number.parseInt(process.env.PLATFORM_SMTP_PORT || '', 10) || 587,
    secure: process.env.PLATFORM_SMTP_SECURE === 'true',
    auth: {
      user: process.env.PLATFORM_SMTP_USER,
      pass: process.env.PLATFORM_SMTP_PASS,
    },
  });
}

/** Eigenes SMTP aktiv = aktivierte Zeile in smtp_settings mit Host. */
export async function hasOwnSmtp() {
  try {
    const result = await query('SELECT smtp_host FROM smtp_settings WHERE id = 1 AND is_enabled = true');
    return Boolean(result.rows[0]?.smtp_host);
  } catch {
    return false;
  }
}

/** @param {'system' | 'customer'} kind */
export async function getMailRoute(kind) {
  if (hasFeature('ownSystemSmtp')) return 'own';
  if (kind === 'system') return 'platform';
  return hasFeature('ownSmtp') && await hasOwnSmtp() ? 'own' : 'platform';
}

/** Tageslimit für Kundenmails über den Plattform-Relay (schützt Brevo-Account und Domain-Reputation). */
export const PLATFORM_MAIL_DAILY_LIMIT = 20;

const BERLIN_DAY_START = "(date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')";

/** Heute (Europe/Berlin) erfolgreich über die Plattform versendete Kundenmails, gezählt pro Empfänger. */
export async function countPlatformCustomerMailsToday() {
  const result = await query(
    `SELECT COALESCE(SUM(array_length(string_to_array(recipient_email, ','), 1)), 0) AS count FROM email_history
     WHERE sender_email = $1 AND status = 'sent'
       AND sent_at >= ${BERLIN_DAY_START}`,
    [getPlatformInstanceSender()]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Express-Middleware vor Kundenmail-Versand: 429, sobald das Tageslimit erreicht ist. */
export async function enforcePlatformMailLimit(req, res, next) {
  try {
    if (req.method === 'GET' || await getMailRoute('customer') !== 'platform') return next();
    // Ein Request kann mehrere Empfänger haben (customerEmails); jeder zählt einzeln.
    const recipients = Array.isArray(req.body?.customerEmails) ? req.body.customerEmails.length : 1;
    if (await countPlatformCustomerMailsToday() + recipients <= PLATFORM_MAIL_DAILY_LIMIT) return next();
    sendPlanError(res, new PlanError(429, {
      error: `Tageslimit für den E-Mail-Versand über OpenBills erreicht (${PLATFORM_MAIL_DAILY_LIMIT} pro Tag). Für mehr bitte Ihren Tarif upgraden.`,
      code: 'PLATFORM_MAIL_LIMIT',
      limit: PLATFORM_MAIL_DAILY_LIMIT,
      plan: getPlanName(),
      upgradeContact: getUpgradeContact(),
    }));
  } catch (error) {
    next(error);
  }
}

/** Tageslimit für Einladungsmails über support@openbills.de (Inhalt teils vom Instanz-Admin bestimmt). */
export const PLATFORM_INVITE_DAILY_LIMIT = 10;

/**
 * true, wenn heute schon PLATFORM_INVITE_DAILY_LIMIT Einladungen per Plattform-Mail verschickt wurden.
 * Zählt über audit_log (nicht im Backup, daher nicht per Restore zurücksetzbar).
 */
export async function platformInviteLimitReached() {
  if (await getMailRoute('system') !== 'platform') return false;
  const result = await query(
    `SELECT COUNT(*) AS count FROM audit_log
     WHERE action = 'user.invited' AND details->>'emailed' = 'true' AND at >= ${BERLIN_DAY_START}`
  );
  return Number(result.rows[0]?.count ?? 0) >= PLATFORM_INVITE_DAILY_LIMIT;
}
