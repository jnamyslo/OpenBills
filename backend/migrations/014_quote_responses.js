/**
 * Migration: Kundenantwort auf Angebote per Mail-Link (annehmen/ablehnen) und AGB-Link der Firma.
 * Siehe docs/superpowers/specs/2026-11-17-quote-response-link.md
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '014_quote_responses';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS quote_responses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      recipients TEXT,
      fingerprint VARCHAR(64) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      responded_at TIMESTAMP WITH TIME ZONE,
      decision VARCHAR(10) CHECK (decision IN ('accepted', 'rejected')),
      responder_name VARCHAR(255),
      comment TEXT,
      terms_url TEXT,
      ip VARCHAR(64),
      user_agent TEXT
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_quote_responses_quote_id ON quote_responses(quote_id)');
  await client.query('ALTER TABLE company ADD COLUMN IF NOT EXISTS terms_url VARCHAR(500)');
}

export async function down(client) {
  await client.query('ALTER TABLE company DROP COLUMN IF EXISTS terms_url');
  await client.query('DROP TABLE IF EXISTS quote_responses');
}
