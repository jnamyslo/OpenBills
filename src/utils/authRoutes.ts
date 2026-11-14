import type { AuthUser } from '../types';

export type PublicAuthRoute =
  | { kind: 'setup' | 'invite' | 'reset'; token: string }
  | { kind: 'forgot' };

const TOKEN_ROUTE = /^(setup|invite|reset)\/([A-Za-z0-9_-]+)$/;

/** Erkennt Hash-Routen, die ohne Anmeldung erreichbar sind (mit oder ohne führendes `#`). */
export function parsePublicAuthRoute(hash: string): PublicAuthRoute | null {
  const route = hash.startsWith('#') ? hash.slice(1) : hash;
  if (route === 'forgot-password') return { kind: 'forgot' };
  const match = TOKEN_ROUTE.exec(route);
  if (!match) return null;
  return { kind: match[1] as 'setup' | 'invite' | 'reset', token: match[2] };
}

export function isAdmin(user: AuthUser | null): boolean {
  return user?.role === 'admin';
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Clientseitige Vorprüfung wie im Backend (Mindestlänge laut Server, max. 128 Zeichen); die Servermeldung hat Vorrang. */
export function newPasswordProblem(password: string, confirmation: string, minLength = PASSWORD_MIN_LENGTH): string | null {
  if (password.length < minLength) return `Das Passwort muss mindestens ${minLength} Zeichen lang sein.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein.`;
  if (password !== confirmation) return 'Die Passwörter stimmen nicht überein.';
  return null;
}

/** Fehlermeldung für die Anzeige auf den Auth-Seiten (Servermeldung hat Vorrang). */
export const errorMessage = (error: unknown, fallback = 'Ein Fehler ist aufgetreten.'): string =>
  error instanceof Error && error.message ? error.message : fallback;
