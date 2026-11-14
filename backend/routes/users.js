import express from 'express';
import { pool, query } from '../database.js';
import logger from '../utils/logger.js';
import { createAuthToken, revokeTokens } from '../auth/tokens.js';
import { normalizeEmail, toPublicUser, findUserByEmail } from '../auth/users.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { audit } from '../auth/audit.js';
import { hashToken } from '../auth/crypto.js';
import { AuthError, sendAuthError } from '../auth/errors.js';
import { getAuthConfig } from '../auth/config.js';
import { isSmtpConfigured, sendInviteMail } from '../services/authMailService.js';

const router = express.Router();

const HOUR = 60 * 60 * 1000;
const ROLES = new Set(['admin', 'user']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INT4 = 2147483647;
const NOT_FOUND = 'Nutzer nicht gefunden';
const EMAIL_TAKEN = 'Diese E-Mail-Adresse ist bereits vergeben';
const LAST_ADMIN = 'Mindestens ein Administrator muss aktiv bleiben';

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Lädt den Nutzer aus :id; Operator, unbekannte und ungültige IDs -> 404.
async function loadTarget(req) {
  const raw = req.params.id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_INT4) throw new AuthError(404, NOT_FOUND, 'NOT_FOUND');
  const { rows } = await query('SELECT * FROM users WHERE id = $1 AND is_operator = false', [id]);
  if (!rows[0]) throw new AuthError(404, NOT_FOUND, 'NOT_FOUND');
  return rows[0];
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE is_operator = false ORDER BY lower(name), id');
    const { rows: ops } = await query('SELECT is_active, last_login_at FROM users WHERE is_operator = true LIMIT 1');
    res.json({
      users: rows.map(toPublicUser),
      operator: { active: Boolean(ops[0]?.is_active), lastLoginAt: ops[0]?.last_login_at ?? null },
    });
  } catch (err) {
    sendAuthError(res, err);
  }
});

router.post('/invite', async (req, res) => {
  try {
    const { email, role } = req.body ?? {};
    const normalized = normalizeEmail(email);
    if (typeof email !== 'string' || normalized.length > 255 || !EMAIL_RE.test(normalized)) {
      throw new AuthError(400, 'Ungültige E-Mail-Adresse', 'VALIDATION_ERROR');
    }
    if (typeof role !== 'string' || !ROLES.has(role)) {
      throw new AuthError(400, 'Ungültige Rolle', 'VALIDATION_ERROR');
    }
    if (await findUserByEmail(normalized)) throw new AuthError(409, EMAIL_TAKEN, 'EMAIL_TAKEN');

    await query(
      `UPDATE auth_tokens SET used_at = now() WHERE kind = 'invite' AND used_at IS NULL AND email = $1`,
      [normalized]
    );
    const token = await createAuthToken({
      kind: 'invite', email: normalized, role, createdBy: req.user.id, ttlMs: 48 * HOUR,
    });
    const link = `${getAuthConfig().publicUrl}/#invite/${token}`;

    let emailed = false;
    if (await isSmtpConfigured()) {
      try {
        await sendInviteMail(normalized, { link, inviterName: req.user.name || 'Ein Administrator' });
        emailed = true;
      } catch (err) {
        logger.error('Einladungs-Mail konnte nicht gesendet werden', { error: err.message });
      }
    }

    await audit(req, { action: 'user.invited', entityType: 'users', details: { role } });
    res.status(201).json({ link, emailed });
  } catch (err) {
    sendAuthError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const target = await loadTarget(req);
    const body = req.body ?? {};
    const changes = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 200) {
        throw new AuthError(400, 'Ungültiger Name', 'VALIDATION_ERROR');
      }
      changes.name = body.name.trim();
    }
    if (body.role !== undefined) {
      if (typeof body.role !== 'string' || !ROLES.has(body.role)) throw new AuthError(400, 'Ungültige Rolle', 'VALIDATION_ERROR');
      changes.role = body.role;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') throw new AuthError(400, 'Ungültiger Status', 'VALIDATION_ERROR');
      changes.isActive = body.isActive;
    }
    const fields = Object.keys(changes);
    if (fields.length === 0) throw new AuthError(400, 'Keine gültigen Änderungen', 'VALIDATION_ERROR');

    const updated = await inTransaction(async (client) => {
      const { rows: admins } = await client.query(
        `SELECT id FROM users WHERE role = 'admin' AND is_active = true AND is_operator = false ORDER BY id FOR UPDATE`
      );
      const { rows } = await client.query('SELECT * FROM users WHERE id = $1 AND is_operator = false FOR UPDATE', [target.id]);
      const current = rows[0];
      if (!current) throw new AuthError(404, NOT_FOUND, 'NOT_FOUND');

      const nextRole = changes.role ?? current.role;
      const nextActive = changes.isActive ?? current.is_active;
      const wasAdmin = current.role === 'admin' && current.is_active;
      const willBeAdmin = nextRole === 'admin' && nextActive;
      if (wasAdmin && !willBeAdmin && admins.length <= 1) throw new AuthError(409, LAST_ADMIN, 'LAST_ADMIN');

      const { rows: out } = await client.query(
        `UPDATE users SET name = $2, role = $3, is_active = $4, updated_at = now() WHERE id = $1 RETURNING *`,
        [current.id, changes.name ?? current.name, nextRole, nextActive]
      );
      // Einladungen eines deaktivierten oder herabgestuften Admins verfallen.
      if (wasAdmin && !willBeAdmin) {
        await client.query(
          `UPDATE auth_tokens SET used_at = now() WHERE kind = 'invite' AND created_by = $1 AND used_at IS NULL`,
          [current.id]
        );
      }
      return { row: out[0] };
    });

    if (!updated.row.is_active) await deleteUserSessions(updated.row.id);

    const details = { fields };
    if (changes.role !== undefined) details.role = changes.role;
    if (changes.isActive !== undefined) details.isActive = changes.isActive;
    await audit(req, { action: 'user.updated', entityType: 'users', entityId: updated.row.id, details });
    res.json({ user: toPublicUser(updated.row) });
  } catch (err) {
    sendAuthError(res, err);
  }
});

router.post('/:id/password-reset-link', async (req, res) => {
  try {
    const target = await loadTarget(req);
    if (!target.is_active) throw new AuthError(409, 'Der Nutzer ist deaktiviert', 'USER_INACTIVE');
    await revokeTokens({ kind: 'password_reset', userId: target.id });
    const token = await createAuthToken({ kind: 'password_reset', userId: target.id, createdBy: req.user.id, ttlMs: HOUR });
    await audit(req, { action: 'user.password_reset_link', entityType: 'users', entityId: target.id });
    res.json({ link: `${getAuthConfig().publicUrl}/#reset/${token}` });
  } catch (err) {
    sendAuthError(res, err);
  }
});

router.post('/:id/totp/reset', async (req, res) => {
  try {
    const target = await loadTarget(req);
    await inTransaction(async (client) => {
      await client.query(
        `UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL,
           totp_last_step = NULL, updated_at = now() WHERE id = $1`,
        [target.id]
      );
      await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [target.id]);
    });
    await audit(req, { action: 'auth.totp_reset', entityType: 'users', entityId: target.id });
    res.status(204).end();
  } catch (err) {
    sendAuthError(res, err);
  }
});

// Hebt Sperre und Fehlversuchs-Limits auf; Passwort und Sessions bleiben unverändert.
router.post('/:id/unlock', async (req, res) => {
  try {
    const target = await loadTarget(req);
    const loginPrefix = `login:user:${hashToken(normalizeEmail(target.email))}:`;
    await inTransaction(async (client) => {
      await client.query(
        'UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
        [target.id]
      );
      // Präfixvergleich statt LIKE: keine Wildcard-Escapes nötig.
      await client.query(
        'DELETE FROM rate_limits WHERE left(key, length($1)) = $1 OR key = ANY($2)',
        [loginPrefix, [`totp:user:${target.id}`, `pwchange:user:${target.id}`]]
      );
    });
    await audit(req, { action: 'user.unlocked', entityType: 'users', entityId: target.id });
    res.status(204).end();
  } catch (err) {
    sendAuthError(res, err);
  }
});

router.delete('/:id/sessions', async (req, res) => {
  try {
    const target = await loadTarget(req);
    await deleteUserSessions(target.id);
    await audit(req, { action: 'user.sessions_revoked', entityType: 'users', entityId: target.id });
    res.status(204).end();
  } catch (err) {
    sendAuthError(res, err);
  }
});

export default router;
