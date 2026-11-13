/**
 * Migration: Plan-Kontingente
 * usage_counters zählt freigegebene Rechnungen/Angebote pro Monat.
 * quota_counted_at verhindert doppeltes Zählen eines Datensatzes.
 */

export const name = '005_plan_usage';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS usage_counters (
      period VARCHAR(7) NOT NULL,
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('invoices', 'quotes')),
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (period, kind)
    )
  `);

  await client.query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quota_counted_at TIMESTAMP WITH TIME ZONE');
  await client.query('ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quota_counted_at TIMESTAMP WITH TIME ZONE');

  // Bestand: bereits freigegebene Datensätze gelten als gezählt, damit spätere Statuswechsel nicht zählen.
  await client.query("UPDATE invoices SET quota_counted_at = created_at WHERE status <> 'draft' AND quota_counted_at IS NULL");
  await client.query("UPDATE quotes SET quota_counted_at = created_at WHERE status <> 'draft' AND quota_counted_at IS NULL");
}

export async function down(client) {
  await client.query('ALTER TABLE quotes DROP COLUMN IF EXISTS quota_counted_at');
  await client.query('ALTER TABLE invoices DROP COLUMN IF EXISTS quota_counted_at');
  await client.query('DROP TABLE IF EXISTS usage_counters');
}
