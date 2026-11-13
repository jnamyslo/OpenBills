export function getAuthConfig() {
  const publicUrl = (process.env.PUBLIC_URL || '').trim();
  let publicOrigin = publicUrl.replace(/\/+$/, '');
  try {
    publicOrigin = new URL(publicUrl).origin;
  } catch {
    // ungültige URL: assertAuthConfig meldet das
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
  if (cfg.encryptionKey.length !== 32) {
    throw new Error('AUTH_ENCRYPTION_KEY fehlt oder ist nicht 32 Byte (base64) lang (erzeugen mit: openssl rand -base64 32)');
  }
}
