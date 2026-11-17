/**
 * Migration: SMTP-Passwort verschlüsselt speichern (AUTH_ENCRYPTION_KEY).
 * Bereits verschlüsselte Werte bleiben unverändert (idempotent).
 */

import { decryptSecret } from '../auth/crypto.js';
import { encryptSmtpPass } from '../utils/smtpPassword.js';

export const name = '008_encrypt_smtp_pass';

function isEncrypted(value) {
  try {
    decryptSecret(value);
    return true;
  } catch {
    return false;
  }
}

export async function up(client) {
  // Chiffrat ist länger als VARCHAR(255)
  await client.query('ALTER TABLE smtp_settings ALTER COLUMN smtp_pass TYPE TEXT');
  const { rows } = await client.query(`SELECT id, smtp_pass FROM smtp_settings WHERE smtp_pass IS NOT NULL AND smtp_pass <> ''`);
  for (const row of rows) {
    if (isEncrypted(row.smtp_pass)) continue;
    await client.query('UPDATE smtp_settings SET smtp_pass = $1 WHERE id = $2', [encryptSmtpPass(row.smtp_pass), row.id]);
  }
}

export async function down() {
  // Kein Zurückschreiben in Klartext.
}
