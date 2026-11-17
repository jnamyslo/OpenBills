import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30000;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Ungültiges Base32-Zeichen');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeForStep(secretBase32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1000000).padStart(6, '0');
}

export function totpCode(secretBase32, timeMs) {
  return codeForStep(secretBase32, Math.floor(timeMs / STEP_MS));
}

export function verifyTotp(secretBase32, code, lastStep, timeMs = Date.now()) {
  const normalized = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = Math.floor(timeMs / STEP_MS);
  const given = Buffer.from(normalized);
  let accepted = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(codeForStep(secretBase32, step));
    const match = crypto.timingSafeEqual(given, expected);
    if (match && (lastStep == null || step > lastStep) && accepted === null) accepted = step;
  }
  return accepted;
}

export function otpauthUri(secretBase32, email) {
  const label = encodeURIComponent(`OpenBills:${email}`).replace('%3A', ':');
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=OpenBills&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes() {
  const codes = new Set();
  while (codes.size < 10) {
    const s = base32Encode(crypto.randomBytes(5)).toLowerCase();
    codes.add(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return [...codes];
}
