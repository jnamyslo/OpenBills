/**
 * Migration: Lokale Authentifizierung
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '006_auth';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
      is_operator BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,
      totp_secret_enc TEXT,
      totp_enabled_at TIMESTAMP WITH TIME ZONE,
      totp_last_step BIGINT,
      totp_pending_enc TEXT,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMP WITH TIME ZONE,
      last_login_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_recovery_codes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash VARCHAR(64) NOT NULL,
      used_at TIMESTAMP WITH TIME ZONE
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash VARCHAR(64) PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      ip TEXT,
      user_agent TEXT,
      mfa_pending BOOLEAN NOT NULL DEFAULT false
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash VARCHAR(64) PRIMARY KEY,
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('onboarding', 'invite', 'password_reset')),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255),
      role VARCHAR(20),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used_at TIMESTAMP WITH TIME ZONE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key VARCHAR(255) PRIMARY KEY,
      window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      count INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      user_id INTEGER,
      actor_label VARCHAR(255),
      is_operator BOOLEAN NOT NULL DEFAULT false,
      action VARCHAR(255) NOT NULL,
      entity_type VARCHAR(100),
      entity_id VARCHAR(100),
      details JSONB,
      ip TEXT,
      user_agent TEXT
    )
  `);

  await client.query('CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_user_id ON user_recovery_codes(user_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_auth_tokens_kind_expires ON auth_tokens(kind, expires_at)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)');

  await client.query(`
    CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'audit_log ist append-only: UPDATE nicht erlaubt';
      END IF;
      IF OLD.at > now() - interval '90 days' THEN
        RAISE EXCEPTION 'audit_log ist append-only: DELETE jüngerer Einträge nicht erlaubt';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql
  `);
  await client.query('DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log');
  await client.query(`
    CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()
  `);
}

export async function down(client) {
  await client.query('DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log');
  await client.query('DROP FUNCTION IF EXISTS audit_log_append_only()');
  await client.query('DROP TABLE IF EXISTS audit_log');
  await client.query('DROP TABLE IF EXISTS rate_limits');
  await client.query('DROP TABLE IF EXISTS auth_tokens');
  await client.query('DROP TABLE IF EXISTS sessions');
  await client.query('DROP TABLE IF EXISTS user_recovery_codes');
  await client.query('DROP TABLE IF EXISTS users');
}
