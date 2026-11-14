import express from 'express';
import { pool, query } from '../database.js';
import logger from '../utils/logger.js';
import { hashToken, encryptSecret, decryptSecret } from '../auth/crypto.js';
import { verifyTotp, generateTotpSecret, otpauthUri, generateRecoveryCodes } from '../auth/totp.js';
import { verifyPassword, verifyDummyPassword, validatePassword, hashPassword, getPasswordMinLength, MAX_LENGTH } from '../auth/password.js';
import {
  findUserByEmail, findUserById, normalizeEmail, recordLoginFailure, recordLoginSuccess, toPublicUser,
  createUser, hasCustomerAdmin,
} from '../auth/users.js';
import { createAuthToken, peekAuthToken, consumeAuthToken, revokeTokens, TOKEN_MESSAGES } from '../auth/tokens.js';
import { getAuthConfig } from '../auth/config.js';
import { isSmtpConfigured, sendPasswordResetMail } from '../services/authMailService.js';
import { reserveAttempt, releaseAttempt, clearRateLimit, LIMITS } from '../auth/rateLimit.js';
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

// Account+IP: ein Angreifer kann so nicht den Login des Kontos von anderen IPs blockieren.
const loginUserKey = (email, req) => `login:user:${hashToken(email)}:${req.ip}`;
const loginIpKey = (req) => `login:ip:${req.ip}`;
const totpUserKey = (userId) => `totp:user:${userId}`;
const passwordChangeKey = (userId) => `pwchange:user:${userId}`;

const isLocked = (user) => Boolean(user.locked_until && new Date(user.locked_until) > new Date());

// Reserviert den Versuch atomar vor der Prüfung für Account+IP- und IP-Schlüssel.
// Liefert Sekunden bis zum Ende der Sperre (0 = Versuch erlaubt).
async function reserveAttempts(accountKey, ipKey) {
  const [account, ip] = await Promise.all([
    reserveAttempt(accountKey, LIMITS.perAccount.limit, LIMITS.perAccount.windowMs),
    reserveAttempt(ipKey, LIMITS.perIp.limit, LIMITS.perIp.windowMs),
  ]);
  return Math.max(account, ip);
}

// Erfolg: Account+IP-Zähler zurücksetzen, den IP-Versuch wieder freigeben.
async function releaseAttempts(accountKey, ipKey) {
  await Promise.all([clearRateLimit(accountKey), releaseAttempt(ipKey)]);
}

function sendRateLimited(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.', code: 'RATE_LIMITED' });
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
    const accountKey = loginUserKey(normalized, req);
    const ipKey = loginIpKey(req);

    const retryAfter = await reserveAttempts(accountKey, ipKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const user = await findUserByEmail(normalized);
    const usable = user && user.is_active;
    let valid = false;
    if (password.length <= MAX_PASSWORD_LENGTH) {
      valid = usable ? await verifyPassword(user.password_hash, password) : await verifyDummyPassword(password);
    }

    if (!valid) {
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
    // Die Reservierung bleibt bestehen, damit das Sperr-Orakel durch das Rate-Limit begrenzt ist.
    if (isLocked(user)) {
      await audit(req, { action: 'auth.login_failed', user, entityType: 'users', entityId: user.id, details: { reason: 'locked' } });
      return res.status(423).json(ACCOUNT_LOCKED);
    }

    await releaseAttempts(accountKey, ipKey);
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

    const retryAfter = await reserveAttempts(accountKey, ipKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const code = String(req.body?.code ?? '').replace(/\s+/g, '').toLowerCase();
    let valid = false;
    if (/^\d{6}$/.test(code)) valid = await verifyTotpCode(user, code);
    else if (RECOVERY_CODE.test(code)) valid = await useRecoveryCode(req, user, code);

    if (!valid) {
      await recordUserFailure(req, user);
      await audit(req, { action: 'auth.login_failed', user, entityType: 'users', entityId: user.id, details: { mfa: true } });
      return res.status(401).json(INVALID_CODE);
    }

    await releaseAttempts(accountKey, ipKey);
    await completeMfa(req.sessionToken);
    return res.json({ user: await finishLogin(req, user) });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/logout', async (req, res) => {
  try {
    clearSessionCookie(res);
    if (req.sessionToken) await deleteSession(req.sessionToken);
    if (req.user) await audit(req, { action: 'auth.logout', entityType: 'users', entityId: req.user.id });
    return res.status(204).end();
  } catch (err) {
    return sendAuthError(res, err);
  }
});

// Öffentlich: Passwort-Richtlinie für Setup-, Einladungs- und Reset-Seiten.
router.get('/password-policy', (req, res) => {
  res.json({ minLength: getPasswordMinLength(), maxLength: MAX_LENGTH });
});

router.get('/me', (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

router.post('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    const user = await findUserById(req.user.id);
    const pwKey = passwordChangeKey(user.id);
    const retryAfter = await reserveAttempt(pwKey, LIMITS.perAccount.limit, LIMITS.perAccount.windowMs);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const currentOk = typeof currentPassword === 'string'
      && currentPassword.length > 0
      && currentPassword.length <= MAX_PASSWORD_LENGTH
      && await verifyPassword(user.password_hash, currentPassword);
    if (!currentOk) throw new AuthError(400, 'Aktuelles Passwort ist falsch', 'INVALID_PASSWORD');
    await clearRateLimit(pwKey);

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

// ---------------------------------------------------------------------------
// Onboarding, Einladung, Passwort-Reset, 2FA verwalten
// ---------------------------------------------------------------------------

const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_FIELD_LENGTH = 255;
const ROLES = new Set(['admin', 'user']);
const ALREADY_SET_UP = 'Instanz ist bereits eingerichtet';
const EMAIL_TAKEN = 'Für diese E-Mail-Adresse existiert bereits ein Konto';
const INVALID_LINK = 'Der Link ist ungültig.';

const setupIpKey = (req) => `setup:ip:${req.ip}`;
const inviteIpKey = (req) => `invite:ip:${req.ip}`;
const resetIpKey = (req) => `reset:ip:${req.ip}`;
const resetCompleteIpKey = (req) => `resetcomplete:ip:${req.ip}`;
const resetUserKey = (email) => `reset:user:${hashToken(email)}`;

const reserveIp = (key) => reserveAttempt(key, LIMITS.perIp.limit, LIMITS.perIp.windowMs);
const reserveAccount = (key) => reserveAttempt(key, LIMITS.perAccount.limit, LIMITS.perAccount.windowMs);

function requireName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_FIELD_LENGTH) {
    throw new AuthError(400, 'Name erforderlich', 'VALIDATION_ERROR');
  }
  return name.trim();
}

function requireEmail(email) {
  const normalized = typeof email === 'string' ? normalizeEmail(email) : '';
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized) || normalized.length > MAX_FIELD_LENGTH) {
    throw new AuthError(400, 'Gültige E-Mail-Adresse erforderlich', 'VALIDATION_ERROR');
  }
  return normalized;
}

function requireStrongPassword(password) {
  const problem = validatePassword(password);
  if (problem) throw new AuthError(400, problem, 'WEAK_PASSWORD');
  return password;
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') throw new AuthError(409, EMAIL_TAKEN, 'EMAIL_TAKEN');
    throw err;
  } finally {
    client.release();
  }
}

// Vorabprüfung ohne Sperre: ungültige Tokens kosten keinen argon2-Hash.
async function requireValidToken(token, kind) {
  const { status } = await peekAuthToken(token, kind);
  if (status !== 'valid') throw new AuthError(400, TOKEN_MESSAGES[status], `token_${status}`);
}

async function startSession(req, res, user) {
  const token = await createSession(user.id, { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
  setSessionCookie(res, token);
}

router.get('/setup/:token', async (req, res) => {
  try {
    if (await hasCustomerAdmin(pool)) return res.json({ status: 'done' });
    const { status } = await peekAuthToken(req.params.token, 'onboarding');
    return res.json({ status });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/setup', async (req, res) => {
  try {
    const ipKey = setupIpKey(req);
    const retryAfter = await reserveIp(ipKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const { token, name, email, password } = req.body ?? {};
    const cleanName = requireName(name);
    const cleanEmail = requireEmail(email);
    await requireValidToken(token, 'onboarding');
    const passwordHash = await hashPassword(requireStrongPassword(password));

    const user = await inTransaction(async (client) => {
      // Serialisiert parallele Setups: nur eines kann den ersten Kunden-Admin anlegen.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('openbills_setup'))`);
      if (await hasCustomerAdmin(client)) throw new AuthError(409, ALREADY_SET_UP, 'ALREADY_SET_UP');
      await consumeAuthToken(client, token, 'onboarding');
      return createUser(client, { email: cleanEmail, name: cleanName, passwordHash, role: 'admin' });
    });

    await releaseAttempt(ipKey);
    await startSession(req, res, user);
    await audit(req, { action: 'user.setup', user, entityType: 'users', entityId: user.id });
    return res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.get('/invite/:token', async (req, res) => {
  try {
    const { status, row } = await peekAuthToken(req.params.token, 'invite');
    if (status !== 'valid') return res.json({ status });
    return res.json({ status, email: row.email, role: row.role });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/invite/:token', async (req, res) => {
  try {
    const ipKey = inviteIpKey(req);
    const retryAfter = await reserveIp(ipKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const { name, password } = req.body ?? {};
    const cleanName = requireName(name);
    await requireValidToken(req.params.token, 'invite');
    const passwordHash = await hashPassword(requireStrongPassword(password));

    const user = await inTransaction(async (client) => {
      const invite = await consumeAuthToken(client, req.params.token, 'invite');
      if (!invite.email || !ROLES.has(invite.role)) throw new AuthError(400, INVALID_LINK, 'token_invalid');
      const { rows } = await client.query('SELECT 1 FROM users WHERE email = $1', [normalizeEmail(invite.email)]);
      if (rows[0]) throw new AuthError(409, EMAIL_TAKEN, 'EMAIL_TAKEN');
      return createUser(client, { email: invite.email, name: cleanName, passwordHash, role: invite.role });
    });

    await releaseAttempt(ipKey);
    await startSession(req, res, user);
    await audit(req, { action: 'user.invite_accepted', user, entityType: 'users', entityId: user.id });
    return res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

// Läuft nach dem Senden der Antwort: Antwortzeit und -inhalt hängen nicht davon ab,
// ob das Konto existiert, ob SMTP konfiguriert ist oder ob der Mailversand klappt.
async function processResetRequest(req, email) {
  try {
    const user = await findUserByEmail(email);
    if (!user || !user.is_active || !(await isSmtpConfigured())) return;
    await revokeTokens({ kind: 'password_reset', userId: user.id });
    const token = await createAuthToken({ kind: 'password_reset', userId: user.id, ttlMs: RESET_TTL_MS });
    await audit(req, { action: 'auth.password_reset_requested', user, entityType: 'users', entityId: user.id });
    await sendPasswordResetMail(user.email, { link: `${getAuthConfig().publicUrl}/#reset/${token}` });
  } catch (err) {
    logger.error('Passwort-Reset-Anfrage fehlgeschlagen', { error: err?.message });
  }
}

router.post('/password-reset/request', async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== 'string' || !email.trim()) {
      throw new AuthError(400, 'E-Mail erforderlich', 'VALIDATION_ERROR');
    }
    const normalized = normalizeEmail(email);
    const [ip, account] = await Promise.all([reserveIp(resetIpKey(req)), reserveAccount(resetUserKey(normalized))]);
    const retryAfter = Math.max(ip, account);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    res.json({ ok: true });
    processResetRequest(req, normalized);
    return undefined;
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.get('/password-reset/:token', async (req, res) => {
  try {
    const { status } = await peekAuthToken(req.params.token, 'password_reset');
    return res.json({ status });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/password-reset/:token', async (req, res) => {
  try {
    const ipKey = resetCompleteIpKey(req);
    const retryAfter = await reserveIp(ipKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);
    await requireValidToken(req.params.token, 'password_reset');

    const passwordHash = await hashPassword(requireStrongPassword(req.body?.password));
    const user = await inTransaction(async (client) => {
      const reset = await consumeAuthToken(client, req.params.token, 'password_reset');
      const { rows } = await client.query(
        `UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL, updated_at = now()
          WHERE id = $1 AND is_active = true
          RETURNING *`,
        [reset.user_id, passwordHash]
      );
      if (!rows[0]) throw new AuthError(400, INVALID_LINK, 'token_invalid');
      return rows[0];
    });
    await releaseAttempt(ipKey);
    await deleteUserSessions(user.id);
    await audit(req, { action: 'auth.password_reset_completed', user, entityType: 'users', entityId: user.id });
    return res.status(204).end();
  } catch (err) {
    return sendAuthError(res, err);
  }
});

const TOTP_ALREADY_ENABLED = 'Zwei-Faktor-Authentifizierung ist bereits aktiv';

router.post('/totp/setup', async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (user.totp_enabled_at) throw new AuthError(409, TOTP_ALREADY_ENABLED, 'TOTP_ALREADY_ENABLED');
    // Step-up: Einrichtung nur mit Passwort; teilt sich das Limit mit der Passwortänderung.
    const pwKey = passwordChangeKey(user.id);
    const retryAfter = await reserveAccount(pwKey);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);
    const { password } = req.body ?? {};
    const passwordOk = typeof password === 'string'
      && password.length > 0
      && password.length <= MAX_PASSWORD_LENGTH
      && await verifyPassword(user.password_hash, password);
    if (!passwordOk) throw new AuthError(400, 'Passwort ist falsch', 'INVALID_PASSWORD');
    await clearRateLimit(pwKey);

    const secret = generateTotpSecret();
    await query('UPDATE users SET totp_pending_enc = $2, updated_at = now() WHERE id = $1', [user.id, encryptSecret(secret)]);
    return res.json({ secret, otpauthUri: otpauthUri(secret, user.email) });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

function verifyPendingTotp(user, code) {
  try {
    const secret = decryptSecret(user.totp_pending_enc);
    const lastStep = user.totp_last_step === null || user.totp_last_step === undefined ? null : Number(user.totp_last_step);
    return verifyTotp(secret, code, lastStep);
  } catch (err) {
    logger.error('TOTP-Einrichtung konnte nicht geprüft werden', { userId: user.id, error: err.message });
    return null;
  }
}

router.post('/totp/enable', async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (user.totp_enabled_at) throw new AuthError(409, TOTP_ALREADY_ENABLED, 'TOTP_ALREADY_ENABLED');
    if (!user.totp_pending_enc) {
      throw new AuthError(400, 'Keine Zwei-Faktor-Einrichtung ausstehend', 'TOTP_NOT_PENDING');
    }
    const key = totpUserKey(user.id);
    const retryAfter = await reserveAccount(key);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const step = verifyPendingTotp(user, req.body?.code);
    if (step === null) return res.status(400).json(INVALID_CODE);

    const recoveryCodes = generateRecoveryCodes();
    await inTransaction(async (client) => {
      // Bedingung schützt vor parallelem enable bzw. neuem setup zwischen Prüfung und Aktivierung.
      const { rowCount } = await client.query(
        `UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL,
                totp_enabled_at = now(), totp_last_step = $2, updated_at = now()
          WHERE id = $1 AND totp_enabled_at IS NULL AND totp_pending_enc = $3`,
        [user.id, step, user.totp_pending_enc]
      );
      if (rowCount !== 1) throw new AuthError(409, TOTP_ALREADY_ENABLED, 'TOTP_ALREADY_ENABLED');
      await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [user.id]);
      await client.query(
        'INSERT INTO user_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])',
        [user.id, recoveryCodes.map((c) => hashToken(c))]
      );
    });

    await clearRateLimit(key);
    await audit(req, { action: 'auth.totp_enabled', entityType: 'users', entityId: user.id });
    return res.json({ recoveryCodes });
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/totp/disable', async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user.totp_enabled_at) {
      throw new AuthError(400, 'Zwei-Faktor-Authentifizierung ist nicht aktiv', 'TOTP_NOT_ENABLED');
    }
    const key = totpUserKey(user.id);
    const retryAfter = await reserveAccount(key);
    if (retryAfter > 0) return sendRateLimited(res, retryAfter);

    const { password, code } = req.body ?? {};
    const passwordOk = typeof password === 'string'
      && password.length > 0
      && password.length <= MAX_PASSWORD_LENGTH
      && await verifyPassword(user.password_hash, password);
    if (!passwordOk) throw new AuthError(400, 'Passwort ist falsch', 'INVALID_PASSWORD');
    if (!(await verifyTotpCode(user, code))) return res.status(400).json(INVALID_CODE);

    await inTransaction(async (client) => {
      await client.query(
        `UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL,
                totp_last_step = NULL, updated_at = now()
          WHERE id = $1`,
        [user.id]
      );
      await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [user.id]);
    });

    await clearRateLimit(key);
    await audit(req, { action: 'auth.totp_disabled', entityType: 'users', entityId: user.id });
    return res.status(204).end();
  } catch (err) {
    return sendAuthError(res, err);
  }
});
export default router;
