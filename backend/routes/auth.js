import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';
import { hashToken, decryptSecret } from '../auth/crypto.js';
import { verifyTotp } from '../auth/totp.js';
import { verifyPassword, verifyDummyPassword, validatePassword, hashPassword } from '../auth/password.js';
import {
  findUserByEmail, findUserById, normalizeEmail, recordLoginFailure, recordLoginSuccess, toPublicUser,
} from '../auth/users.js';
import { checkRateLimit, recordAttempt, clearRateLimit, LIMITS } from '../auth/rateLimit.js';
import {
  createSession, completeMfa, deleteSession, deleteUserSessions, setSessionCookie, clearSessionCookie,
} from '../auth/sessions.js';
import { audit } from '../auth/audit.js';
import { AuthError, sendAuthError } from '../auth/errors.js';

const router = express.Router();

// Längere Passwörter werden ohne argon2-Aufruf abgelehnt (DoS-Schutz).
const MAX_PASSWORD_LENGTH = 128;

const INVALID_LOGIN = { error: 'E-Mail oder Passwort falsch' };
const ACCOUNT_LOCKED = { error: 'Konto vorübergehend gesperrt', code: 'ACCOUNT_LOCKED' };
const INVALID_CODE = { error: 'Code ungültig', code: 'INVALID_CODE' };

const loginUserKey = (email) => `login:user:${hashToken(email)}`;
const loginIpKey = (req) => `login:ip:${req.ip}`;
const totpUserKey = (userId) => `totp:user:${userId}`;

const isLocked = (user) => Boolean(user.locked_until && new Date(user.locked_until) > new Date());

// Liefert Sekunden bis zum Ende der Sperre (0 = frei). Prüft Account- und IP-Schlüssel.
async function rateLimitRetryAfter(accountKey, ipKey) {
  const [account, ip] = await Promise.all([
    checkRateLimit(accountKey, LIMITS.perAccount.limit, LIMITS.perAccount.windowMs),
    checkRateLimit(ipKey, LIMITS.perIp.limit, LIMITS.perIp.windowMs),
  ]);
  return Math.max(account, ip);
}

function sendRateLimited(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.', code: 'RATE_LIMITED' });
}

async function recordFailedAttempt(accountKey, ipKey) {
  await Promise.all([
    recordAttempt(accountKey, LIMITS.perAccount.windowMs),
    recordAttempt(ipKey, LIMITS.perIp.windowMs),
  ]);
}

// Zählt einen Fehlversuch für die Sperre und protokolliert eine neu ausgelöste Sperre.
async function recordUserFailure(req, user) {
  const { lockedUntil } = await recordLoginFailure(user.id);
  if (lockedUntil && !isLocked(user)) {
    await audit(req, { action: 'auth.locked', user, entityType: 'users', entityId: user.id });
  }
}

function loginDetails(user) {
  return user.is_operator ? { operator: true } : null;
}

async function finishLogin(req, user) {
  await recordLoginSuccess(user.id);
  await audit(req, { action: 'auth.login', user, entityType: 'users', entityId: user.id, details: loginDetails(user) });
  return toPublicUser(await findUserById(user.id));
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      throw new AuthError(400, 'E-Mail und Passwort erforderlich', 'VALIDATION_ERROR');
    }
    const normalized = normalizeEmail(email);
    const accountKey = loginUserKey(normalized);
    const ipKey = loginIpKey(req);

    const retryAfter = await rateLimitRetryAfter(accountKey, ipKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const user = await findUserByEmail(normalized);
    const usable = user && user.is_active;
    let valid = false;
    if (password.length <= MAX_PASSWORD_LENGTH) {
      valid = usable ? await verifyPassword(user.password_hash, password) : await verifyDummyPassword(password);
    }

    if (!valid) {
      await recordFailedAttempt(accountKey, ipKey);
      if (usable) await recordUserFailure(req, user);
      await audit(req, {
        action: 'auth.login_failed',
        user: usable ? user : null,
        entityType: usable ? 'users' : null,
        entityId: usable ? user.id : null,
      });
      return res.status(401).json(INVALID_LOGIN);
    }

    // Sperre erst nach korrektem Passwort melden: falsche Passwörter bekommen weiter die neutrale 401.
    if (isLocked(user)) {
      await audit(req, { action: 'auth.login_failed', user, entityType: 'users', entityId: user.id, details: { reason: 'locked' } });
      return res.status(423).json(ACCOUNT_LOCKED);
    }

    await clearRateLimit(accountKey);
    const sessionMeta = { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };

    if (user.totp_enabled_at) {
      const token = await createSession(user.id, { ...sessionMeta, mfaPending: true });
      setSessionCookie(res, token);
      return res.json({ mfaRequired: true });
    }

    const token = await createSession(user.id, sessionMeta);
    setSessionCookie(res, token);
    return res.json({ user: await finishLogin(req, user) });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

const RECOVERY_CODE = /^[a-z2-7]{4}-[a-z2-7]{4}$/;

async function verifyTotpCode(user, code) {
  let secret;
  try {
    secret = decryptSecret(user.totp_secret_enc);
  } catch (err) {
    logger.error('TOTP-Secret konnte nicht entschlüsselt werden', { userId: user.id, error: err.message });
    return false;
  }
  const lastStep = user.totp_last_step === null || user.totp_last_step === undefined ? null : Number(user.totp_last_step);
  let step;
  try {
    step = verifyTotp(secret, code, lastStep);
  } catch (err) {
    logger.error('TOTP-Prüfung fehlgeschlagen', { userId: user.id, error: err.message });
    return false;
  }
  if (step === null) return false;
  // Atomar, damit derselbe Code nicht parallel zweimal akzeptiert wird.
  const { rowCount } = await query(
    `UPDATE users SET totp_last_step = $2, updated_at = now()
      WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
    [user.id, step]
  );
  return rowCount === 1;
}

async function useRecoveryCode(req, user, code) {
  const { rows } = await query(
    `UPDATE user_recovery_codes SET used_at = now()
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
      RETURNING id`,
    [user.id, hashToken(code)]
  );
  if (!rows[0]) return false;
  await audit(req, { action: 'auth.recovery_code_used', user, entityType: 'users', entityId: user.id });
  return true;
}

router.post('/login/totp', async (req, res) => {
  try {
    if (req.session?.mfa_pending !== true || !req.user) {
      throw new AuthError(400, 'Keine ausstehende Zwei-Faktor-Anmeldung', 'MFA_NOT_PENDING');
    }
    const user = req.user;
    const accountKey = totpUserKey(user.id);
    const ipKey = loginIpKey(req);

    const retryAfter = await rateLimitRetryAfter(accountKey, ipKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const code = String(req.body?.code ?? '').replace(/\s+/g, '').toLowerCase();
    let valid = false;
    if (/^\d{6}$/.test(code)) valid = await verifyTotpCode(user, code);
    else if (RECOVERY_CODE.test(code)) valid = await useRecoveryCode(req, user, code);

    if (!valid) {
      await recordFailedAttempt(accountKey, ipKey);
      await recordUserFailure(req, user);
      await audit(req, { action: 'auth.login_failed', user, entityType: 'users', entityId: user.id, details: { mfa: true } });
      return res.status(401).json(INVALID_CODE);
    }

    await clearRateLimit(accountKey);
    await completeMfa(req.sessionToken);
    return res.json({ user: await finishLogin(req, user) });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/logout', async (req, res) => {
  try {
    if (req.sessionToken) await deleteSession(req.sessionToken);
    clearSessionCookie(res);
    if (req.user) await audit(req, { action: 'auth.logout', entityType: 'users', entityId: req.user.id });
    return res.status(204).end();
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.get('/me', (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

router.post('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    const user = await findUserById(req.user.id);
    const currentOk = typeof currentPassword === 'string'
      && currentPassword.length > 0
      && currentPassword.length <= MAX_PASSWORD_LENGTH
      && await verifyPassword(user.password_hash, currentPassword);
    if (!currentOk) throw new AuthError(400, 'Aktuelles Passwort ist falsch', 'INVALID_PASSWORD');

    const problem = validatePassword(newPassword);
    if (problem) throw new AuthError(400, problem, 'WEAK_PASSWORD');

    await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
      user.id,
      await hashPassword(newPassword),
    ]);
    await deleteUserSessions(user.id, { exceptToken: req.sessionToken });
    await audit(req, { action: 'auth.password_changed', entityType: 'users', entityId: user.id });
    return res.status(204).end();
  } catch (err) {
    return sendAuthError(res, err);
  }
});

export default router;
