import { MAX_LENGTH, PASSWORD_MIN_LENGTH_FLOOR } from './password.js';

export function getAuthConfig() {
  const publicUrl = (process.env.PUBLIC_URL || '').trim();
  let publicOrigin = publicUrl.replace(/\/+$/, '');
  try {
    publicOrigin = new URL(publicUrl).origin;
  } catch {
    // ungültige URL: assertAuthConfig lehnt sie beim Start ab; hier nur Fallback
  }
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10);
  return {
    publicUrl,
    publicOrigin,
    secureCookies: publicUrl.startsWith('https://'),
    encryptionKey: Buffer.from((process.env.AUTH_ENCRYPTION_KEY || '').trim(), 'base64'),
    trustProxyHops: Number.isInteger(hops) && hops >= 0 ? hops : 2,
  };
}

export function assertAuthConfig() {
  const cfg = getAuthConfig();
  if (!cfg.publicUrl) {
    throw new Error('PUBLIC_URL fehlt (z. B. https://rechnung.example.de)');
  }
  let protocol;
  try {
    protocol = new URL(cfg.publicUrl).protocol;
  } catch {
    protocol = null;
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('PUBLIC_URL ist ungültig (erwartet http:// oder https://, z. B. https://rechnung.example.de)');
  }
  const minLength = (process.env.PASSWORD_MIN_LENGTH || '').trim();
  if (minLength !== '' && !(/^\d+$/.test(minLength) && Number(minLength) >= PASSWORD_MIN_LENGTH_FLOOR && Number(minLength) <= MAX_LENGTH)) {
    throw new Error(`PASSWORD_MIN_LENGTH ist ungültig ("${minLength}"). Erlaubt: ganze Zahl von ${PASSWORD_MIN_LENGTH_FLOOR} bis ${MAX_LENGTH} oder leer (= 12).`);
  }
  if (cfg.encryptionKey.length !== 32) {
    throw new Error('AUTH_ENCRYPTION_KEY fehlt oder ist nicht 32 Byte (base64) lang (erzeugen mit: openssl rand -base64 32)');
  }
}
