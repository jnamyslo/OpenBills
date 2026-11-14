import { isDemoMode } from './index.js';

const TOKEN = '[A-Za-z0-9_-]+';
const ID = '[^/]+';

// Aktionen, mit denen Besucher den gemeinsamen Demo-Zugang oder die Instanz kaputt machen könnten.
// Pfade relativ zu /api, vollständig verankert (wie PUBLIC_API_PATHS).
export const DEMO_BLOCKED = [
  { method: 'POST', pattern: /^\/auth\/password$/ },
  { method: 'POST', pattern: /^\/auth\/totp\/(setup|enable|disable)$/ },
  { method: 'POST', pattern: /^\/auth\/password-reset\/request$/ },
  { method: 'POST', pattern: new RegExp(`^/auth/password-reset/${TOKEN}$`) },
  { method: 'POST', pattern: /^\/auth\/setup$/ },
  { method: 'POST', pattern: new RegExp(`^/auth/invite/${TOKEN}$`) },
  { method: 'POST', pattern: /^\/users\/invite$/ },
  { method: 'PUT', pattern: new RegExp(`^/users/${ID}$`) },
  { method: 'POST', pattern: new RegExp(`^/users/${ID}/.+$`) },
  { method: 'DELETE', pattern: new RegExp(`^/users/${ID}/sessions$`) },
  { method: 'POST', pattern: /^\/backup\/restore-zip$/ },
  { method: 'DELETE', pattern: /^\/backup\/delete\/.+$/ },
  { method: 'POST', pattern: /^\/email-management\/(smtp-settings|debug-config|diagnose-smtp|test-smtp|test-network|send-test-email)$/ },
];

const DEMO_DISABLED = { error: 'In der Demo deaktiviert', code: 'DEMO_DISABLED' };

// Express-Router matchen ohne Groß-/Kleinschreibung und tolerieren `/` am Ende sowie `//`.
// Deshalb vor dem Vergleich normalisieren, sonst wäre die Sperre per `/auth/password/` umgehbar.
function normalizePath(path) {
  return path.toLowerCase().replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1');
}

/** Muss in der /api-Kette nach requireAuth und vor den Routern hängen. */
export function demoGuard(req, res, next) {
  if (!isDemoMode()) return next();
  const path = normalizePath(req.path);
  if (DEMO_BLOCKED.some((p) => p.method === req.method && p.pattern.test(path))) {
    return res.status(403).json(DEMO_DISABLED);
  }
  next();
}

/**
 * Zusätzliche Absicherung auf Router-Ebene (Express-Mount-Matching, also robust gegen Pfadvarianten):
 * in der Demo sind hier alle schreibenden Aufrufe gesperrt – u. a. SMTP-Tests, die ausgehende Verbindungen öffnen.
 */
export function demoBlockWrites(req, res, next) {
  if (isDemoMode() && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return res.status(403).json(DEMO_DISABLED);
  }
  next();
}
