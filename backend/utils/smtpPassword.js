import { encryptSecret, decryptSecret } from '../auth/crypto.js';

// smtp_settings.smtp_pass liegt mit AUTH_ENCRYPTION_KEY verschlüsselt in der DB.
// Leere Werte (null/'') bleiben unverändert.

export function encryptSmtpPass(plain) {
  return plain ? encryptSecret(plain) : plain;
}

export function decryptSmtpPass(stored) {
  return stored ? decryptSecret(stored) : stored;
}
