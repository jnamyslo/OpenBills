import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { generateToken, hashToken, encryptSecret, decryptSecret } from '../auth/crypto.js';
import { getAuthConfig, assertAuthConfig } from '../auth/config.js';

const KEY32 = Buffer.alloc(32, 7).toString('base64');

beforeEach(() => {
  vi.stubEnv('PUBLIC_URL', 'https://test.example');
  vi.stubEnv('AUTH_ENCRYPTION_KEY', KEY32);
});
afterEach(() => vi.unstubAllEnvs());

describe('tokens', () => {
  it('generateToken liefert 43 base64url-Zeichen, jedes Mal anders', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashToken ist sha256 hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('Roundtrip', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('zwei Verschlüsselungen unterscheiden sich', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('Manipulation wirft', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    const last = enc.slice(-1);
    const tampered = enc.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('config', () => {
  it('assertAuthConfig wirft ohne PUBLIC_URL', () => {
    vi.stubEnv('PUBLIC_URL', '');
    expect(() => assertAuthConfig()).toThrow(/PUBLIC_URL/);
  });

  it('assertAuthConfig wirft bei 16-Byte-Key', () => {
    vi.stubEnv('AUTH_ENCRYPTION_KEY', Buffer.alloc(16, 1).toString('base64'));
    expect(() => assertAuthConfig()).toThrow(/AUTH_ENCRYPTION_KEY/);
  });

  it('assertAuthConfig ok bei gültiger Konfiguration', () => {
    expect(() => assertAuthConfig()).not.toThrow();
  });

  it('https => publicOrigin ohne Slash, secureCookies', () => {
    vi.stubEnv('PUBLIC_URL', 'https://a.example/');
    const c = getAuthConfig();
    expect(c.publicOrigin).toBe('https://a.example');
    expect(c.secureCookies).toBe(true);
    expect(c.encryptionKey.length).toBe(32);
  });

  it('http => secureCookies false; trustProxyHops Default 2', () => {
    vi.stubEnv('PUBLIC_URL', 'http://localhost:8080');
    const c = getAuthConfig();
    expect(c.secureCookies).toBe(false);
    expect(c.trustProxyHops).toBe(2);
  });

  it('TRUST_PROXY_HOPS überschreibbar', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    expect(getAuthConfig().trustProxyHops).toBe(1);
  });
});
