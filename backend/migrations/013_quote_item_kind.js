/**
 * Migration: Art der Angebotsposition (Arbeitszeit oder Material)
 * Positionen aus einer Stundensatz-Vorlage sind 'labor'; beim Umwandeln in einen Auftrag
 * werden sie als Zeiteintrag (Menge x Stundensatz) übernommen, alles andere als Material.
 * Bestehende Positionen bleiben 'material'.
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '013_quote_item_kind';

export async function up(client) {
  await client.query(`
    ALTER TABLE quote_items
      ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'material',
      ADD COLUMN IF NOT EXISTS hourly_rate_id UUID
  `);
}

export async function down(client) {
  await client.query('ALTER TABLE quote_items DROP COLUMN IF EXISTS hourly_rate_id');
  await client.query('ALTER TABLE quote_items DROP COLUMN IF EXISTS kind');
}
