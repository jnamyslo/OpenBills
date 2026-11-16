/**
 * Migration: Gesamtrabatt am Auftrag
 * Wird aus dem Angebot übernommen und bei der Abrechnung auf die Rechnung angewendet.
 * Gespeichert werden nur Art und Wert; der Betrag ergibt sich erst aus der Rechnungssumme.
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '012_job_global_discount';

export async function up(client) {
  await client.query(`
    ALTER TABLE job_entries
      ADD COLUMN IF NOT EXISTS global_discount_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS global_discount_value DECIMAL(10,2)
  `);
}

export async function down(client) {
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS global_discount_value');
  await client.query('ALTER TABLE job_entries DROP COLUMN IF EXISTS global_discount_type');
}
