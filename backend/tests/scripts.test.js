import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { createUser, findUserByEmail, OPERATOR_EMAIL } from '../auth/users.js';
import { verifyPassword } from '../auth/password.js';
import { createSession, getSession } from '../auth/sessions.js';
import { hashToken } from '../auth/crypto.js';
import { resetOperator } from '../scripts/operator.js';
import { createOnboardingLink } from '../scripts/onboarding.js';

describe.skipIf(!hasDb)('Betreiber-Skripte (DB)', () => {
  beforeAll(migrateTestDb);
  afterAll(() => pool.end());
  beforeEach(resetAuthTables);

  it('resetOperator legt Operator an und setzt Passwort neu', async () => {
    const first = await resetOperator();
    expect(first.email).toBe(OPERATOR_EMAIL);
    expect(first.password).toHaveLength(24);
    const op = await findUserByEmail(OPERATOR_EMAIL);
    expect(op.is_operator).toBe(true);
    expect(op.role).toBe('admin');
    expect(op.name).toBe('Support-Zugang');

    const token = await createSession(op.id);
    await pool.query(
      `UPDATE users SET totp_secret_enc='x', totp_enabled_at=now(), failed_login_count=5, locked_until=now()+interval '1 hour', is_active=false WHERE id=$1`,
      [op.id]
    );
    await pool.query(`INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, 'h')`, [op.id]);

    const second = await resetOperator();
    expect(second.password).not.toBe(first.password);
    const { rows } = await pool.query('SELECT * FROM users');
    expect(rows).toHaveLength(1);
    expect(await verifyPassword(rows[0].password_hash, second.password)).toBe(true);
    expect(await verifyPassword(rows[0].password_hash, first.password)).toBe(false);
    expect(rows[0].totp_secret_enc).toBeNull();
    expect(rows[0].totp_enabled_at).toBeNull();
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].failed_login_count).toBe(0);
    expect(rows[0].locked_until).toBeNull();
    expect((await pool.query('SELECT 1 FROM user_recovery_codes')).rowCount).toBe(0);
    expect(await getSession(token)).toBeNull();
    const { rows: log } = await pool.query(`SELECT * FROM audit_log WHERE action='operator.reset'`);
    expect(log).toHaveLength(2);
    expect(log[0].actor_label).toBe('System');
    expect(log[0].entity_type).toBe('users');
  });

  it('resetOperator wandelt keinen normalen Nutzer um', async () => {
    await createUser(pool, { email: OPERATOR_EMAIL, name: 'X', passwordHash: 'x', role: 'user' });
    await expect(resetOperator()).rejects.toThrow(/existiert bereits/);
  });

  it('createOnboardingLink liefert URL und widerruft alten Token', async () => {
    const a = await createOnboardingLink();
    expect(a).toMatch(/^https:\/\/test\.example\/#setup\/[A-Za-z0-9_-]{43}$/);
    const b = await createOnboardingLink();
    expect(b).not.toBe(a);
    const { rows } = await pool.query('SELECT used_at FROM auth_tokens WHERE token_hash=$1', [
      hashToken(a.split('/').pop()),
    ]);
    expect(rows[0].used_at).not.toBeNull();
  });

  it('createOnboardingLink wirft mit Kunden-Admin', async () => {
    await createUser(pool, { email: 'a@kunde.de', name: 'A', passwordHash: 'x', role: 'admin' });
    await expect(createOnboardingLink()).rejects.toThrow('Instanz ist bereits eingerichtet (Kunden-Admin vorhanden).');
  });
});
