import { pathToFileURL } from 'url';
import { pool } from '../database.js';
import { hasCustomerAdmin } from '../auth/users.js';
import { createAuthToken, revokeTokens } from '../auth/tokens.js';
import { getAuthConfig } from '../auth/config.js';

const ONBOARDING_TTL_MS = 48 * 60 * 60 * 1000;

export async function createOnboardingLink() {
  if (await hasCustomerAdmin(pool)) {
    throw new Error('Instanz ist bereits eingerichtet (Kunden-Admin vorhanden).');
  }
  await revokeTokens({ kind: 'onboarding' });
  const token = await createAuthToken({ kind: 'onboarding', ttlMs: ONBOARDING_TTL_MS });
  return `${getAuthConfig().publicUrl}/#setup/${token}`;
}

export function parseOnboardingArgs(argv) {
  let sendTo = null;
  let platformEnvFromStdin = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--send-to') {
      const value = argv[++i];
      if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new Error('--send-to benötigt eine gültige E-Mail-Adresse.');
      }
      sendTo = value;
    } else if (arg === '--platform-env-stdin') {
      platformEnvFromStdin = true;
    } else {
      throw new Error(`Unbekannte Option: ${arg}`);
    }
  }
  return { sendTo, platformEnvFromStdin };
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { sendTo, platformEnvFromStdin } = parseOnboardingArgs(process.argv.slice(2));
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
    if (platformEnvFromStdin) {
      const parsed = dotenv.parse(await readStdin());
      for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith('PLATFORM_SMTP_') && !process.env[key]) process.env[key] = value;
      }
    }
    const { assertAuthConfig } = await import('../auth/config.js');
    assertAuthConfig();
    const { createTables } = await import('../database.js');
    await createTables();
    const url = await createOnboardingLink();
    console.log(`Onboarding-Link (48 h gültig): ${url}`);
    if (sendTo) {
      const { getPlanName } = await import('../utils/plan.js');
      const plan = getPlanName();
      if (plan === 'selfhosted') {
        throw new Error('Self-Hosted: kein Plattform-Versand, Link bitte manuell senden.');
      }
      const { sendOnboardingMail } = await import('../services/authMailService.js');
      const { getPlatformInstanceSender } = await import('../services/mailRouting.js');
      await sendOnboardingMail(sendTo, { link: url, plan, instanceSender: getPlatformInstanceSender() });
      console.log(`Onboarding-Mail an ${sendTo} gesendet.`);
    }
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
