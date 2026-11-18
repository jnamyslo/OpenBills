/**
 * Migration: Belegarchiv (append-only) und Storno-Felder an Rechnungen.
 * Siehe docs/superpowers/specs/2026-11-17-document-archive-storno.md
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '015_document_archive';

const STATUSES_OLD = ['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'];
const STATUSES_NEW = [...STATUSES_OLD, 'cancelled'];

// Name des Status-CHECKs aus 001 nicht raten: alle CHECKs auf invoices.status ermitteln.
async function replaceStatusCheck(client, statuses) {
  const { rows } = await client.query(`
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'invoices'::regclass AND c.contype = 'c' AND a.attname = 'status'
  `);
  for (const { conname } of rows) {
    await client.query(`ALTER TABLE invoices DROP CONSTRAINT ${client.escapeIdentifier(conname)}`);
  }
  const list = statuses.map((s) => `'${s}'`).join(', ');
  await client.query(`ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN (${list}))`);
}

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS document_archive (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('invoice', 'quote', 'reminder')),
      document_id UUID NOT NULL,
      document_number VARCHAR(50) NOT NULL,
      customer_name VARCHAR(255),
      issue_date DATE,
      total DECIMAL(10,2),
      reminder_stage INTEGER CHECK (reminder_stage BETWEEN 1 AND 3),
      format VARCHAR(20) NOT NULL CHECK (format IN ('pdf', 'zugferd', 'xrechnung')),
      filename VARCHAR(255) NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      size INTEGER NOT NULL,
      content TEXT NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      source VARCHAR(20) NOT NULL CHECK (source IN ('output', 'regenerated')),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      created_by INTEGER, -- users.id, ohne FK (users ist nicht im Backup)
      UNIQUE (document_type, document_id, format, sha256)
    )
  `);
  await client.query(
    'CREATE INDEX IF NOT EXISTS idx_document_archive_document ON document_archive(document_type, document_id)'
  );
  await client.query(`
    CREATE OR REPLACE FUNCTION document_archive_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'document_archive ist append-only: % nicht erlaubt', TG_OP;
    END;
    $$ LANGUAGE plpgsql
  `);
  await client.query('DROP TRIGGER IF EXISTS document_archive_append_only ON document_archive');
  await client.query(`
    CREATE TRIGGER document_archive_append_only
    BEFORE UPDATE OR DELETE ON document_archive
    FOR EACH ROW EXECUTE FUNCTION document_archive_append_only()
  `);

  await client.query(`
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(20) NOT NULL DEFAULT 'invoice'
      CHECK (invoice_type IN ('invoice', 'cancellation'))
  `);
  // DEFERRABLE: Der Restore fügt Rechnungen in beliebiger Reihenfolge ein (Storno vor Original möglich).
  await client.query(`
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancels_invoice_id UUID
      REFERENCES invoices(id) DEFERRABLE INITIALLY DEFERRED
  `);
  await client.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancellation_reason TEXT');
  await client.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_cancels_invoice_id ON invoices(cancels_invoice_id) WHERE cancels_invoice_id IS NOT NULL'
  );
  await replaceStatusCheck(client, STATUSES_NEW);
}

export async function down(client) {
  await replaceStatusCheck(client, STATUSES_OLD);
  await client.query('DROP INDEX IF EXISTS idx_invoices_cancels_invoice_id');
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS cancellation_reason');
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS cancels_invoice_id');
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS invoice_type');
  await client.query('DROP TRIGGER IF EXISTS document_archive_append_only ON document_archive');
  await client.query('DROP FUNCTION IF EXISTS document_archive_append_only()');
  await client.query('DROP TABLE IF EXISTS document_archive');
}
