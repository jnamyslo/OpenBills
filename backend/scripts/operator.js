import { pathToFileURL } from 'url';
import { pool } from '../database.js';
import { OPERATOR_EMAIL } from '../auth/users.js';
import { hashPassword } from '../auth/password.js';
import { generateToken } from '../auth/crypto.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { audit } from '../auth/audit.js';

const OPERATOR_NAME = 'Support-Zugang';

export async function resetOperator() {
  const password = generateToken().slice(0, 24);
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  let id;
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT id, is_operator FROM users WHERE email = $1 FOR UPDATE', [
      OPERATOR_EMAIL,
    ]);
    if (existing[0] && !existing[0].is_operator) {
      throw new Error(`Ein Nutzer mit der E-Mail ${OPERATOR_EMAIL} existiert bereits und ist kein Support-Zugang.`);
    }
    if (existing[0]) {
      id = existing[0].id;
      await client.query(
        `UPDATE users SET password_hash = $2, is_operator = true, role = 'admin', is_active = true,
           failed_login_count = 0, locked_until = NULL, totp_secret_enc = NULL, totp_enabled_at = NULL,
           totp_last_step = NULL, totp_pending_enc = NULL
         WHERE id = $1`,
        [id, passwordHash]
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (email, name, password_hash, role, is_operator) VALUES ($1, $2, $3, 'admin', true) RETURNING id`,
        [OPERATOR_EMAIL, OPERATOR_NAME, passwordHash]
      );
      id = rows[0].id;
    }
    await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await deleteUserSessions(id);
  await audit(null, { action: 'operator.reset', entityType: 'users', entityId: id });
  return { email: OPERATOR_EMAIL, password };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
    const { assertAuthConfig } = await import('../auth/config.js');
    assertAuthConfig();
    const { createTables } = await import('../database.js');
    await createTables();
    const { email, password } = await resetOperator();
    console.log('Support-Zugang (einmalig angezeigt, sicher ablegen):');
    console.log(`  E-Mail:   ${email}`);
    console.log(`  Passwort: ${password}`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
