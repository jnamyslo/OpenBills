import { pathToFileURL } from 'url';
import { pool } from '../database.js';

const PLANS = ['free', 'starter', 'professional', 'enterprise'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** --old <plan> [--send-to <email>] [--platform-env-stdin]; ohne --send-to geht die Mail an die Kunden-Admins der Instanz. */
export function parsePlanChangeArgs(argv) {
  let oldPlan = null;
  let sendTo = null;
  let platformEnvFromStdin = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--old') {
      oldPlan = argv[++i];
      if (!PLANS.includes(oldPlan)) throw new Error('--old benötigt einen gültigen Tarif.');
    } else if (arg === '--send-to') {
      sendTo = argv[++i];
      if (!sendTo || !EMAIL.test(sendTo)) throw new Error('--send-to benötigt eine gültige E-Mail-Adresse.');
    } else if (arg === '--platform-env-stdin') {
      platformEnvFromStdin = true;
    } else {
      throw new Error(`Unbekannte Option: ${arg}`);
    }
  }
  if (!oldPlan) throw new Error('--old <plan> fehlt.');
  return { oldPlan, sendTo, platformEnvFromStdin };
}

export async function customerAdminEmails(client) {
  const { rows } = await client.query(
    `SELECT email FROM users WHERE role = 'admin' AND is_active = true AND is_operator = false ORDER BY id`
  );
  return rows.map((r) => r.email);
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { oldPlan, sendTo, platformEnvFromStdin } = parsePlanChangeArgs(process.argv.slice(2));
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
    if (platformEnvFromStdin) {
      const parsed = dotenv.parse(await readStdin());
      for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith('PLATFORM_SMTP_') && !process.env[key]) process.env[key] = value;
      }
    }
    const { getPlanName } = await import('../utils/plan.js');
    const newPlan = getPlanName();
    if (newPlan === 'selfhosted') throw new Error('Self-Hosted: kein Plattform-Versand.');
    const recipients = sendTo ? [sendTo] : await customerAdminEmails(pool);
    if (recipients.length === 0) throw new Error('Kein Empfänger: keine Kunden-Admins gefunden und --send-to nicht angegeben.');
    const { sendPlanChangeMail } = await import('../services/authMailService.js');
    const { getPlatformInstanceSender } = await import('../services/mailRouting.js');
    for (const to of recipients) {
      await sendPlanChangeMail(to, { oldPlan, newPlan, instanceSender: getPlatformInstanceSender() });
      console.log(`Tarifwechsel-Mail an ${to} gesendet.`);
    }
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
