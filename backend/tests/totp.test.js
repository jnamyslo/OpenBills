import { describe, it, expect } from 'vitest';
import { generateTotpSecret, totpCode, verifyTotp, otpauthUri, generateRecoveryCodes } from '../auth/totp.js';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('matches RFC 6238 vectors (6 digits)', () => {
    expect(totpCode(SECRET, 59 * 1000)).toBe('287082');
    expect(totpCode(SECRET, 1111111109 * 1000)).toBe('081804');
    expect(totpCode(SECRET, 1234567890 * 1000)).toBe('005924');
    expect(totpCode(SECRET, 2000000000 * 1000)).toBe('279037');
  });

  it('generates 20-byte base32 secret without padding', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(s);
  });

  describe('verifyTotp', () => {
    const t = 1234567890 * 1000;
    const step = Math.floor(t / 30000);
    it('accepts current, previous and next step', () => {
      expect(verifyTotp(SECRET, totpCode(SECRET, t), null, t)).toBe(step);
      expect(verifyTotp(SECRET, totpCode(SECRET, t - 30000), null, t)).toBe(step - 1);
      expect(verifyTotp(SECRET, totpCode(SECRET, t + 30000), null, t)).toBe(step + 1);
    });
    it('rejects +-2 steps', () => {
      expect(verifyTotp(SECRET, totpCode(SECRET, t - 60000), null, t)).toBeNull();
      expect(verifyTotp(SECRET, totpCode(SECRET, t + 60000), null, t)).toBeNull();
    });
    it('rejects replay of same or older step', () => {
      expect(verifyTotp(SECRET, totpCode(SECRET, t), step, t)).toBeNull();
      expect(verifyTotp(SECRET, totpCode(SECRET, t - 30000), step, t)).toBeNull();
      expect(verifyTotp(SECRET, totpCode(SECRET, t + 30000), step, t)).toBe(step + 1);
    });
    it('ignores whitespace and rejects malformed codes', () => {
      const c = totpCode(SECRET, t);
      expect(verifyTotp(SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, null, t)).toBe(step);
      expect(verifyTotp(SECRET, 'abcdef', null, t)).toBeNull();
      expect(verifyTotp(SECRET, '', null, t)).toBeNull();
    });
  });

  it('builds otpauth URI', () => {
    const u = otpauthUri(SECRET, 'a@b.de');
    expect(u.startsWith('otpauth://totp/OpenBills:')).toBe(true);
    expect(u).toContain('secret=' + SECRET);
    expect(u).toContain('issuer=OpenBills');
  });

  it('generates 10 unique recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/);
  });
});
