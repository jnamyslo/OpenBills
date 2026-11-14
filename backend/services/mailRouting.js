/**
 * Mail-Routing für Hosted-Tarife: entscheidet pro Mailart, ob über den Plattform-Relay
 * (PLATFORM_SMTP_* aus .env.platform) oder das eigene SMTP der Instanz versendet wird.
 * Siehe docs/superpowers/specs/2026-11-14-platform-mail-design.md
 */
import nodemailer from 'nodemailer';
import { query } from '../database.js';
import { hasFeature } from '../utils/plan.js';

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
