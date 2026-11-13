import { pool } from '../database.js';
import { generateToken, hashToken } from './crypto.js';
import { AuthError } from './errors.js';
import { normalizeEmail } from './users.js';

export async function createAuthToken({ kind, userId = null, email = null, role = null, createdBy = null, ttlMs }) {
  const token = generateToken();
  await pool.query(
    `INSERT INTO auth_tokens (token_hash, kind, user_id, email, role, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'), $7)`,
    [hashToken(token), kind, userId, email ? normalizeEmail(email) : null, role, ttlMs, createdBy]
  );
  return token;
}

function statusOf(row) {
  if (row.used_at) return 'used';
  if (new Date(row.expires_at) <= new Date()) return 'expired';
  return 'valid';
}

export async function peekAuthToken(token, kind) {
  const { rows } = await pool.query('SELECT * FROM auth_tokens WHERE token_hash = $1 AND kind = $2', [
    hashToken(String(token ?? '')),
    kind,
  ]);
  if (!rows[0]) return { status: 'invalid' };
  return { status: statusOf(rows[0]), row: rows[0] };
}

const MESSAGES = {
  invalid: 'Der Link ist ungültig.',
  expired: 'Der Link ist abgelaufen.',
  used: 'Der Link wurde bereits verwendet.',
};

export async function consumeAuthToken(client, token, kind) {
  const { rows } = await client.query(
    'SELECT * FROM auth_tokens WHERE token_hash = $1 AND kind = $2 FOR UPDATE',
    [hashToken(String(token ?? '')), kind]
  );
  const status = rows[0] ? statusOf(rows[0]) : 'invalid';
  if (status !== 'valid') throw new AuthError(400, MESSAGES[status], `token_${status}`);
  const { rows: updated } = await client.query(
    'UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 RETURNING *',
    [rows[0].token_hash]
  );
  return updated[0];
}

export async function revokeTokens({ kind, userId } = {}) {
  const params = [kind];
  let sql = 'UPDATE auth_tokens SET used_at = now() WHERE kind = $1 AND used_at IS NULL';
  if (userId !== undefined && userId !== null) {
    params.push(userId);
    sql += ' AND user_id = $2';
  }
  await pool.query(sql, params);
}
