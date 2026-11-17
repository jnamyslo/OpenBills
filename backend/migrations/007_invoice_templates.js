/**
 * Migration: Rechnungsvorlagen
 * Vorlagen werden als JSONB-Array in der company-Zeile gespeichert.
 */

export const name = '007_invoice_templates';

export async function up(client) {
  await client.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS invoice_templates JSONB NOT NULL DEFAULT '[]'::jsonb`);
}

export async function down(client) {
  await client.query('ALTER TABLE company DROP COLUMN IF EXISTS invoice_templates');
}
