import { describe, expect, it } from 'vitest';
import { isAdmin, newPasswordProblem, parsePublicAuthRoute } from '../authRoutes';
import type { AuthUser } from '../../types';

const user = (role: 'admin' | 'user'): AuthUser => ({
  id: 1,
  email: 'a@example.com',
  name: 'A',
  role,
  isOperator: false,
  isActive: true,
  totpEnabled: false,
  lastLoginAt: null,
  createdAt: '2026-11-13T00:00:00.000Z',
});

describe('parsePublicAuthRoute', () => {
  it('erkennt Token-Routen', () => {
    expect(parsePublicAuthRoute('#setup/abc')).toEqual({ kind: 'setup', token: 'abc' });
    expect(parsePublicAuthRoute('#invite/x')).toEqual({ kind: 'invite', token: 'x' });
    expect(parsePublicAuthRoute('#reset/y')).toEqual({ kind: 'reset', token: 'y' });
    expect(parsePublicAuthRoute('reset/Ab_9-z')).toEqual({ kind: 'reset', token: 'Ab_9-z' });
  });

  it('erkennt Passwort vergessen', () => {
    expect(parsePublicAuthRoute('#forgot-password')).toEqual({ kind: 'forgot' });
    expect(parsePublicAuthRoute('forgot-password')).toEqual({ kind: 'forgot' });
  });

  it('liefert null für andere Routen und ungültige Tokens', () => {
    expect(parsePublicAuthRoute('#dashboard')).toBeNull();
    expect(parsePublicAuthRoute('#setup/')).toBeNull();
    expect(parsePublicAuthRoute('#setup')).toBeNull();
    expect(parsePublicAuthRoute('#setup/a/b')).toBeNull();
    expect(parsePublicAuthRoute('#invite/a.b')).toBeNull();
    expect(parsePublicAuthRoute('')).toBeNull();
  });
});

describe('isAdmin', () => {
  it('nur für role admin', () => {
    expect(isAdmin(user('user'))).toBe(false);
    expect(isAdmin(user('admin'))).toBe(true);
    expect(isAdmin(null)).toBe(false);
  });
});

describe('newPasswordProblem', () => {
  it('prüft Länge und Bestätigung', () => {
    expect(newPasswordProblem('kurz', 'kurz')).toMatch(/mindestens 12/);
    expect(newPasswordProblem('a'.repeat(129), 'a'.repeat(129))).toMatch(/höchstens 128/);
    expect(newPasswordProblem('a'.repeat(12), 'b'.repeat(12))).toMatch(/nicht überein/);
    expect(newPasswordProblem('a'.repeat(12), 'a'.repeat(12))).toBeNull();
  });
});
