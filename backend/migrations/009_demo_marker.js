/**
 * Migration: Demo-Markierung
 * Eine Zeile hier kennzeichnet die DB als Demo-Datenbank; nur dann darf der Demo-Reset sie leeren.
 * Siehe docs/superpowers/specs/2026-11-14-demo-mode-design.md
 */

export const name = '009_demo_marker';

export async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS demo_marker (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

export async function down(client) {
  await client.query('DROP TABLE IF EXISTS demo_marker');
}
