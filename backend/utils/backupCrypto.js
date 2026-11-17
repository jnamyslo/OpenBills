import crypto from 'node:crypto';

// Passwortbasierte Verschlüsselung der ZIP-Backups. Das Passwort wird nirgends gespeichert;
// ohne es ist ein Backup nicht wiederherstellbar.
export const MIN_PASSPHRASE_LENGTH = 12;

const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;

export class BackupPassphraseError extends Error {}

function deriveKey(passphrase, salt, { N, r, p }) {
  return crypto.scryptSync(passphrase, salt, 32, { N, r, p, maxmem: MAXMEM });
}

export function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Das Backup-Passwort muss mindestens ${MIN_PASSPHRASE_LENGTH} Zeichen lang sein.`;
  }
  return null;
}

export function encryptBackup(plain, passphrase) {
  const invalid = validatePassphrase(passphrase);
  if (invalid) throw new Error(invalid);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt, SCRYPT), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    header: {
      version: 1,
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      ...SCRYPT,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext,
  };
}

export function decryptBackup(header, ciphertext, passphrase) {
  if (header?.version !== 1 || header.cipher !== 'aes-256-gcm' || header.kdf !== 'scrypt') {
    throw new Error('Unbekanntes Verschlüsselungsformat des Backups');
  }
  if (typeof passphrase !== 'string' || passphrase === '') {
    throw new BackupPassphraseError('Das Backup ist verschlüsselt – bitte Backup-Passwort angeben.');
  }
  // Parameter aus der Datei begrenzen, sonst kann ein präpariertes Backup beliebig viel Speicher anfordern
  const { N, r, p } = header;
  if (N > SCRYPT.N || r > SCRYPT.r || p > SCRYPT.p) {
    throw new Error('Unzulässige Verschlüsselungsparameter im Backup');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      deriveKey(passphrase, Buffer.from(header.salt, 'base64'), { N, r, p }),
      Buffer.from(header.iv, 'base64'),
      { authTagLength: 16 }
    );
    decipher.setAuthTag(Buffer.from(header.tag, 'base64'));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new BackupPassphraseError('Falsches Backup-Passwort oder beschädigte Backup-Datei.');
  }
}
