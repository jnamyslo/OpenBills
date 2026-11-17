import { pool } from '../../database.js';
import { createUser } from '../../auth/users.js';
import { createSession, SESSION_COOKIE } from '../../auth/sessions.js';

export const ORIGIN = { Origin: 'https://test.example' };

let counter = 0;

export async function loginAs(role, { mfaPending = false } = {}) {
  counter += 1;
  const user = await createUser(pool, {
    email: `${role}${counter}@test.example`,
    name: `${role} ${counter}`,
    passwordHash: 'x',
    role,
  });
  const token = await createSession(user.id, { mfaPending });
  return { cookie: `${SESSION_COOKIE}=${token}`, token, user };
}

export async function waitForAudit(action, { timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query('SELECT * FROM audit_log WHERE action = $1 ORDER BY id DESC', [action]);
    if (rows.length > 0 || Date.now() >= deadline) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
}
