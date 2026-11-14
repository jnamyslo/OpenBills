import { hash, verify, Algorithm } from '@node-rs/argon2';
import { commonPasswords } from './commonPasswords.js';

const DEFAULT_MIN_LENGTH = 12;
export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const MAX_LENGTH = 128;

/** Mindestlänge aus PASSWORD_MIN_LENGTH (leer = 12). Gültigkeit prüft assertAuthConfig beim Start. */
export function getPasswordMinLength() {
  const raw = (process.env.PASSWORD_MIN_LENGTH || '').trim();
  return raw === '' ? DEFAULT_MIN_LENGTH : Number(raw);
}

// OWASP-Empfehlung für argon2id: 19 MiB, 2 Iterationen, 1 Thread
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw) => hash(pw, OPTIONS);

export async function verifyPassword(storedHash, pw) {
  try {
    return await verify(storedHash, pw);
  } catch {
    return false;
  }
}

let dummyHash;

// Gleiche Laufzeit wie eine echte Prüfung, wenn die E-Mail unbekannt ist.
export async function verifyDummyPassword(pw) {
  dummyHash ??= await hashPassword('openbills-dummy-password');
  await verifyPassword(dummyHash, pw);
  return false;
}

export function validatePassword(pw) {
  const minLength = getPasswordMinLength();
  if (typeof pw !== 'string' || pw.length < minLength) {
    return `Das Passwort muss mindestens ${minLength} Zeichen lang sein.`;
  }
  if (pw.length > MAX_LENGTH) {
    return `Das Passwort darf höchstens ${MAX_LENGTH} Zeichen lang sein.`;
  }
  if (commonPasswords.has(pw.toLowerCase())) {
    return 'Dieses Passwort ist zu häufig verwendet. Bitte wähle ein anderes.';
  }
  return null;
}
