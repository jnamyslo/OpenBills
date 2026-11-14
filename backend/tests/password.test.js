import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertAuthConfig } from '../auth/config.js';
import { hashPassword, verifyPassword, verifyDummyPassword, validatePassword, getPasswordMinLength } from '../auth/password.js';
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

describe('PASSWORD_MIN_LENGTH', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('Default 12', () => {
    vi.stubEnv('PASSWORD_MIN_LENGTH', '');
    expect(getPasswordMinLength()).toBe(12);
    expect(validatePassword('abcdefgh')).toMatch(/mindestens 12/);
  });

  it('per Env auf 8 gesenkt', () => {
    vi.stubEnv('PASSWORD_MIN_LENGTH', '8');
    expect(getPasswordMinLength()).toBe(8);
    expect(validatePassword('abcdefgh')).toBeNull();
    expect(validatePassword('abcdefg')).toBe('Das Passwort muss mindestens 8 Zeichen lang sein.');
  });

  it('assertAuthConfig lehnt ungültige Werte ab', () => {
    for (const bad of ['7', '129', 'abc', '10.5']) {
      vi.stubEnv('PASSWORD_MIN_LENGTH', bad);
      expect(() => assertAuthConfig(), bad).toThrow(/PASSWORD_MIN_LENGTH/);
    }
    for (const ok of ['', '8', '128']) {
      vi.stubEnv('PASSWORD_MIN_LENGTH', ok);
      expect(() => assertAuthConfig(), ok).not.toThrow();
    }
  });
});
