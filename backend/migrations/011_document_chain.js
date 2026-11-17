/**
 * Migration: Belegkette Angebot → Auftrag → Rechnung
 * job_entries.quote_id   = Angebot, aus dem der Auftrag erzeugt wurde
 * job_entries.invoice_id = Rechnung, auf der der Auftrag abgerechnet wurde (mehrere Aufträge je Rechnung möglich)
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '011_document_chain';

export async function up(client) {
  await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL');
  await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL');
  await client.query('CREATE INDEX IF NOT EXISTS idx_job_entries_quote_id ON job_entries(quote_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_job_entries_invoice_id ON job_entries(invoice_id)');
}

export async function down(client) {
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS invoice_id');
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS quote_id');
}
