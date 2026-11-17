import { describe, it, expect } from 'vitest';
import { encryptBackup, decryptBackup, BackupPassphraseError, MIN_PASSPHRASE_LENGTH } from '../utils/backupCrypto.js';

const PASS = 'richtig-langes-passwort';

describe('backupCrypto', () => {
  it('verschlüsselt und entschlüsselt verlustfrei', () => {
    const plain = Buffer.from(JSON.stringify({ geheim: 'Kundendaten äöü' }));
    const { header, ciphertext } = encryptBackup(plain, PASS);
    expect(ciphertext.includes(plain)).toBe(false);
    expect(header).toMatchObject({ version: 1, cipher: 'aes-256-gcm', kdf: 'scrypt' });
    expect(decryptBackup(header, ciphertext, PASS).equals(plain)).toBe(true);
  });

  it('nutzt pro Backup neues Salt und IV', () => {
    const a = encryptBackup(Buffer.from('x'), PASS).header;
    const b = encryptBackup(Buffer.from('x'), PASS).header;
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it('lehnt falsches Passwort ab', () => {
    const { header, ciphertext } = encryptBackup(Buffer.from('daten'), PASS);
    expect(() => decryptBackup(header, ciphertext, 'falsches-passwort-123')).toThrow(BackupPassphraseError);
  });

  it('lehnt manipulierten Inhalt ab', () => {
    const { header, ciphertext } = encryptBackup(Buffer.from('daten'), PASS);
    ciphertext[0] ^= 1;
    expect(() => decryptBackup(header, ciphertext, PASS)).toThrow(BackupPassphraseError);
  });

  it('lehnt zu kurze Passwörter beim Verschlüsseln ab', () => {
    expect(() => encryptBackup(Buffer.from('x'), 'a'.repeat(MIN_PASSPHRASE_LENGTH - 1))).toThrow(/mindestens/);
  });
});
