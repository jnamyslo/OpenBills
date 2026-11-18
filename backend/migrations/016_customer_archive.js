/**
 * Migration: Kunden archivieren statt löschen (Sperrung während der Aufbewahrungsfrist).
 * Siehe docs/superpowers/plans/2026-11-17-document-archive-storno.md, Task 12.
 * Idempotent (IF NOT EXISTS), da ein Restore alter Backups den migrations-Stand zurücksetzen kann.
 */

export const name = '016_customer_archive';

export async function up(client) {
  await client.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE');
}

export async function down(client) {
  await client.query('ALTER TABLE customers DROP COLUMN IF EXISTS archived_at');
}
