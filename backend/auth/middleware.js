import { getAuthConfig } from './config.js';
import { getSession, SESSION_COOKIE } from './sessions.js';
import { audit, describeRequest } from './audit.js';

const TOKEN = '[A-Za-z0-9_-]+';

// Pfade relativ zu /api (req.path innerhalb von app.use('/api', …)), vollständig verankert.
export const PUBLIC_API_PATHS = [
  { method: 'POST', pattern: /^\/auth\/login$/ },
  { method: 'POST', pattern: /^\/auth\/login\/totp$/ },
  { method: 'GET', pattern: new RegExp(`^/auth/setup/${TOKEN}$`) },
  { method: 'POST', pattern: /^\/auth\/setup$/ },
  { method: 'GET', pattern: new RegExp(`^/auth/invite/${TOKEN}$`) },
  { method: 'POST', pattern: new RegExp(`^/auth/invite/${TOKEN}$`) },
  { method: 'POST', pattern: /^\/auth\/password-reset\/request$/ },
  { method: 'GET', pattern: new RegExp(`^/auth/password-reset/${TOKEN}$`) },
  { method: 'POST', pattern: new RegExp(`^/auth/password-reset/${TOKEN}$`) },
  { method: 'GET', pattern: /^\/auth\/password-policy$/ },
  { method: 'GET', pattern: /^\/demo$/ },
];

// Für Sessions mit mfa_pending zusätzlich erreichbar.
const MFA_PENDING_PATHS = [
  { method: 'POST', pattern: /^\/auth\/login\/totp$/ },
  { method: 'POST', pattern: /^\/auth\/logout$/ },
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const READ_METHODS = new Set(['GET', 'HEAD']);

const matches = (list, req) => list.some((p) => p.method === req.method && p.pattern.test(req.path));

const AUTH_REQUIRED = { error: 'Nicht angemeldet', code: 'AUTH_REQUIRED' };
const MFA_REQUIRED = { error: 'Zwei-Faktor-Bestätigung erforderlich', code: 'MFA_REQUIRED' };
const FORBIDDEN = { error: 'Keine Berechtigung', code: 'FORBIDDEN' };
const ORIGIN_MISMATCH = { error: 'Ungültige Herkunft der Anfrage', code: 'ORIGIN_MISMATCH' };

export async function loadSession(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    const result = token ? await getSession(token) : null;
    if (result) {
      req.user = result.user;
      req.session = result.session;
      req.sessionToken = token;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (matches(PUBLIC_API_PATHS, req)) return next();
  if (!req.user || !req.session) return res.status(401).json(AUTH_REQUIRED);
  if (req.session.mfa_pending && !matches(MFA_PENDING_PATHS, req)) {
    return res.status(401).json(MFA_REQUIRED);
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || !req.session || req.session.mfa_pending) return res.status(401).json(AUTH_REQUIRED);
  if (req.user.role !== 'admin') return res.status(403).json(FORBIDDEN);
  next();
}

export function requireAdminForWrites(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  return requireAdmin(req, res, next);
}

function requestOrigin(req) {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function originCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (requestOrigin(req) !== getAuthConfig().publicOrigin) return res.status(403).json(ORIGIN_MISMATCH);
  next();
}

const UNAUDITED_PREFIX = /^\/api\/(auth|users)(\/|$)/i;

export function auditWrites(req, res, next) {
  if (READ_METHODS.has(req.method) || req.method === 'OPTIONS') return next();
  const originalUrl = req.originalUrl;
  const path = originalUrl.split('?')[0];
  if (UNAUDITED_PREFIX.test(path)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    const status = req.body?.status;
    const details = typeof status === 'string' || typeof status === 'number' ? { status } : null;
    audit(req, { ...describeRequest(req.method, originalUrl), details });
  });
  next();
}
