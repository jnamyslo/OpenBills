/**
 * Migration: Onboarding-Status je Benutzer
 * NULL = Einrichtungsassistent noch nicht abgeschlossen/übersprungen.
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '010_user_onboarding';

export async function up(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'onboarding_completed_at'`
  );
  if (rows.length > 0) return;
  await client.query('ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMP WITH TIME ZONE');
  // Bestehende Benutzer sind bereits eingerichtet und sollen den Assistenten nicht nachträglich sehen.
  await client.query('UPDATE users SET onboarding_completed_at = NOW()');
}

export async function down(client) {
  await client.query('ALTER TABLE users DROP COLUMN IF EXISTS onboarding_completed_at');
}
