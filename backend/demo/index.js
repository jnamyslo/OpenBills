import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

/**
 * Demo-Modus (OPENBILLS_DEMO=true): öffentliche, abgeriegelte Demo-Instanz.
 * Siehe docs/superpowers/specs/2026-11-14-demo-mode-design.md
 */

// Fester, öffentlich angezeigter Demo-Zugang – kein Geheimnis.
export const DEMO_EMAIL = 'demo@openbills.de';
export const DEMO_PASSWORD = 'demo';

export function isDemoMode() {
  return (process.env.OPENBILLS_DEMO || '').trim() === 'true';
}

/** Startprüfung: Demo läuft immer als selfhosted (alle Features), ein Tarif wäre widersprüchlich. */
export function assertDemoConfig() {
  if (isDemoMode() && (process.env.OPENBILLS_PLAN || '').trim() !== '') {
    throw new Error('OPENBILLS_DEMO und OPENBILLS_PLAN schließen sich aus – für die Demo OPENBILLS_PLAN leer lassen.');
  }
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
