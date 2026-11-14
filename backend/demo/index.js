import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

/**
 * Demo-Modus (OPENBILLS_DEMO=true): öffentliche, abgeriegelte Demo-Instanz.
 * Siehe docs/superpowers/specs/2026-11-14-demo-mode-design.md
 */

// Fester, öffentlich angezeigter Demo-Zugang – kein Geheimnis.
export const DEMO_EMAIL = 'demo@openbills.de';
export const DEMO_PASSWORD = 'demo';

const RESET_INTERVAL_HOURS = 3;

export function isDemoMode() {
  return (process.env.OPENBILLS_DEMO || '').trim() === 'true';
}

/** Startprüfung: Demo läuft immer als selfhosted (alle Features), ein Tarif wäre widersprüchlich. */
export function assertDemoConfig() {
  if (isDemoMode() && (process.env.OPENBILLS_PLAN || '').trim() !== '') {
    throw new Error('OPENBILLS_DEMO und OPENBILLS_PLAN schließen sich aus – für die Demo OPENBILLS_PLAN leer lassen.');
  }
}

/** Nächster Reset: volle Stunde mit hour % 3 === 0 (Container-Zeitzone), strikt nach `now`. */
export function nextResetAt(now) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  do {
    next.setHours(next.getHours() + 1);
  } while (next.getHours() % RESET_INTERVAL_HOURS !== 0);
  return next;
}

/** Transport, der nichts versendet (nodemailer jsonTransport) und nur protokolliert. */
export function createDemoTransporter() {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  return {
    options: transport.options,
    verify: async () => true,
    sendMail: async (mail) => {
      const info = await transport.sendMail(mail);
      logger.info('Demo: Mail nicht versendet', { to: mail.to, subject: mail.subject });
      return info;
    },
  };
}
