import { query } from '../database.js';
import { currentPeriod, getLimit, planLimitError } from '../utils/plan.js';

const TABLES = { invoices: 'invoices', quotes: 'quotes' };

/**
 * Zählt eine Rechnung/ein Angebot gegen das Monatskontingent, sobald es den Entwurfsstatus verlässt.
 * Läuft innerhalb der Transaktion des Aufrufers (client). Jeder Datensatz zählt höchstens einmal
 * (quota_counted_at); Löschen gibt kein Kontingent zurück.
 * Wirft PlanError (402), wenn das Limit erreicht ist.
 */
export async function countReleaseIfNeeded(client, kind, id, status) {
  if (status === 'draft') return;
  const table = TABLES[kind];
  if (!table) throw new Error(`Unbekannte Kontingent-Art: ${kind}`);

  const row = await client.query(`SELECT quota_counted_at FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  if (row.rows.length === 0 || row.rows[0].quota_counted_at) return;

  const period = currentPeriod();
  await client.query(
    'INSERT INTO usage_counters (period, kind, count) VALUES ($1, $2, 0) ON CONFLICT (period, kind) DO NOTHING',
    [period, kind]
  );
  const counter = await client.query(
    'SELECT count FROM usage_counters WHERE period = $1 AND kind = $2 FOR UPDATE',
    [period, kind]
  );
  const used = counter.rows[0].count;
  const limit = getLimit(kind);
  if (limit !== null && used >= limit) throw planLimitError(kind, limit);

  await client.query('UPDATE usage_counters SET count = count + 1 WHERE period = $1 AND kind = $2', [period, kind]);
  await client.query(`UPDATE ${table} SET quota_counted_at = NOW() WHERE id = $1`, [id]);
}

/** Wirft PlanError (402), wenn kein weiterer Kunde angelegt werden darf. */
export async function assertCustomerSlotAvailable() {
  const limit = getLimit('customers');
  if (limit === null) return;
  const result = await query('SELECT COUNT(*)::int AS count FROM customers');
  if (result.rows[0].count >= limit) throw planLimitError('customers', limit);
}

/** Aktuelle Nutzung für GET /api/plan. */
export async function getUsage() {
  const period = currentPeriod();
  const counters = await query('SELECT kind, count FROM usage_counters WHERE period = $1', [period]);
  const byKind = Object.fromEntries(counters.rows.map(r => [r.kind, r.count]));
  const customers = await query('SELECT COUNT(*)::int AS count FROM customers');
  return {
    period,
    invoices: byKind.invoices ?? 0,
    quotes: byKind.quotes ?? 0,
    customers: customers.rows[0].count,
  };
}
