import { query } from '../database.js';

export const OPERATOR_EMAIL = 'support@openbills.de';

export function normalizeEmail(e) {
  return String(e ?? '').trim().toLowerCase();
}

export async function findUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createUser(client, { email, name, passwordHash, role, isOperator = false }) {
  const { rows } = await client.query(
    `INSERT INTO users (email, name, password_hash, role, is_operator)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [normalizeEmail(email), name, passwordHash, role, isOperator]
  );
  return rows[0];
}

export async function hasCustomerAdmin(client) {
  return (await countActiveCustomerAdmins(client)) > 0;
}

export async function countActiveCustomerAdmins(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active = true AND is_operator = false`
  );
  return rows[0].n;
}

export async function recordLoginFailure(userId) {
  const { rows } = await query(
    `UPDATE users SET
       failed_login_count = CASE WHEN failed_login_count + 1 >= 10 THEN 0 ELSE failed_login_count + 1 END,
       locked_until = CASE WHEN failed_login_count + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END,
       updated_at = now()
     WHERE id = $1
     RETURNING locked_until`,
    [userId]
  );
  const lockedUntil = rows[0]?.locked_until || null;
  return { lockedUntil: lockedUntil && lockedUntil > new Date() ? lockedUntil : null };
}

export async function recordLoginSuccess(userId) {
  await query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now() WHERE id = $1`,
    [userId]
  );
}

export function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isOperator: row.is_operator,
    isActive: row.is_active,
    totpEnabled: Boolean(row.totp_enabled_at),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    lockedUntil: row.locked_until && new Date(row.locked_until) > new Date() ? new Date(row.locked_until).toISOString() : null,
  };
}
