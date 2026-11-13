import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyDummyPassword, validatePassword } from '../auth/password.js';
import { commonPasswords } from '../auth/commonPasswords.js';

describe('Passwort-Hashing', () => {
  it('erzeugt argon2id-Hash und verifiziert', async () => {
    const h = await hashPassword('korrekt pferd batterie');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'korrekt pferd batterie')).toBe(true);
    expect(await verifyPassword(h, 'falsch falsch falsch')).toBe(false);
  });

  it('verifyPassword liefert false bei kaputtem Hash', async () => {
    expect(await verifyPassword('kein-hash', 'x')).toBe(false);
  });

  it('verifyDummyPassword liefert false', async () => {
    expect(await verifyDummyPassword('irgendwas')).toBe(false);
  });
});

describe('validatePassword', () => {
  it('zu kurz', () => expect(validatePassword('kurz')).toMatch(/mindestens 12/));
  it('zu lang', () => expect(validatePassword('a'.repeat(129))).toMatch(/höchstens 128/));
  it('128 Zeichen ok', () => expect(validatePassword('a1b2'.repeat(32))).toBeNull());
  it('häufig, case-insensitiv', () => expect(validatePassword('Passwort1234')).toMatch(/zu häufig/));
  it('Passphrase ok', () => expect(validatePassword('korrekt pferd batterie')).toBeNull());
  it('Liste: nur Einträge >= 12 Zeichen, lowercase', () => {
    expect(commonPasswords.size).toBeGreaterThanOrEqual(190);
    for (const p of commonPasswords) {
      expect(p.length).toBeGreaterThanOrEqual(12);
      expect(p).toBe(p.toLowerCase());
    }
  });
});
