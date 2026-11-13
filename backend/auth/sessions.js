import { query } from '../database.js';
import { generateToken, hashToken } from './crypto.js';
import { getAuthConfig } from './config.js';

export const SESSION_COOKIE = 'ob_session';

const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(userId, { ip = null, userAgent = null, mfaPending = false } = {}) {
  const token = generateToken();
  await query(
    `INSERT INTO sessions (id_hash, user_id, ip, user_agent, mfa_pending, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`,
    [hashToken(token), userId, ip, userAgent, mfaPending]
  );
  return token;
}

export async function getSession(token) {
  if (!token || typeof token !== 'string') return null;
  const idHash = hashToken(token);
  const { rows } = await query(
    `SELECT s.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1
        AND s.expires_at > now()
        AND s.last_seen_at > now() - interval '12 hours'
        AND (NOT s.mfa_pending OR s.created_at > now() - interval '5 minutes')
        AND u.is_active = true
        AND (u.locked_until IS NULL OR u.locked_until <= now())`,
    [idHash]
  );
  if (!rows[0]) return null;
  const session = rows[0];
  await query(
    `UPDATE sessions SET last_seen_at = now()
      WHERE id_hash = $1 AND last_seen_at < now() - interval '1 minute'`,
    [idHash]
  );
  const { rows: users } = await query('SELECT * FROM users WHERE id = $1', [session.user_id]);
  return { session, user: users[0] };
}

export async function completeMfa(token) {
  await query(
    `UPDATE sessions SET mfa_pending = false, last_seen_at = now() WHERE id_hash = $1`,
    [hashToken(token)]
  );
}

export async function deleteSession(token) {
  await query('DELETE FROM sessions WHERE id_hash = $1', [hashToken(token)]);
}

export async function deleteUserSessions(userId, { exceptToken } = {}) {
  if (exceptToken) {
    await query('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [userId, hashToken(exceptToken)]);
  } else {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: getAuthConfig().secureCookies,
    path: '/',
  };
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: ABSOLUTE_MS });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export async function cleanupSessions() {
  await query(
    `DELETE FROM sessions
      WHERE expires_at <= now()
         OR last_seen_at <= now() - interval '12 hours'
         OR (mfa_pending AND created_at <= now() - interval '5 minutes')`
  );
}
