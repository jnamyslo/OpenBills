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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
    const { assertAuthConfig } = await import('../auth/config.js');
    assertAuthConfig();
    const { createTables } = await import('../database.js');
    await createTables();
    const url = await createOnboardingLink();
    console.log(`Onboarding-Link (48 h gültig): ${url}`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
