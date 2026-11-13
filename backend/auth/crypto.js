import crypto from 'node:crypto';
import { getAuthConfig } from './config.js';

export function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getAuthConfig().encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(enc) {
  const [version, iv, tag, ct] = String(enc).split(':');
  if (version !== 'v1' || !iv || !tag || ct === undefined) {
    throw new Error('Ungültiges Secret-Format');
  }
  const ivBuf = Buffer.from(iv, 'base64');
  const tagBuf = Buffer.from(tag, 'base64');
  const ctBuf = Buffer.from(ct, 'base64');
  // nicht-kanonisches Base64 (z. B. verändertes Padding) würde sonst unbemerkt gleich dekodieren
  if (ivBuf.toString('base64') !== iv || tagBuf.toString('base64') !== tag || ctBuf.toString('base64') !== ct) {
    throw new Error('Ungültiges Secret-Format');
  }
  if (ivBuf.length !== 12 || tagBuf.length !== 16) {
    throw new Error('Ungültiges Secret-Format');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getAuthConfig().encryptionKey, ivBuf, { authTagLength: 16 });
  decipher.setAuthTag(tagBuf);
  return Buffer.concat([decipher.update(ctBuf), decipher.final()]).toString('utf8');
}
