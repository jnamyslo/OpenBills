// Storno freigegebener Rechnungen: Stornorechnung im Kreis ST-YYYY-NNN, beide Belege 'cancelled'.
// Spec: docs/superpowers/specs/2026-11-17-document-archive-storno.md § 3

import { pool } from '../database.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import { generateInvoiceNumber } from './invoiceService.js';

const MAX_REASON_LENGTH = 500;
const MAX_ATTEMPTS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// Datum (YYYY-MM-DD) in deutscher Zeit; der Container läuft in UTC.
export function berlinDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(date);
}

function validate(id, { reason, releaseSources, replacementInvoiceId }) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw httpError(404, 'Rechnung nicht gefunden');
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'Bitte einen Stornogrund angeben.');
  if (reason.trim().length > MAX_REASON_LENGTH) throw httpError(400, `Der Stornogrund darf höchstens ${MAX_REASON_LENGTH} Zeichen lang sein.`);
  if (typeof releaseSources !== 'boolean') throw httpError(400, 'releaseSources muss true oder false sein.');
  if (replacementInvoiceId !== null && (typeof replacementInvoiceId !== 'string' || !UUID_RE.test(replacementInvoiceId))) {
    throw httpError(400, 'Ungültige Ersatzrechnung.');
  }
}

async function assertReplacement(client, original, replacementInvoiceId) {
  const { rows: [replacement] } = await client.query(
    'SELECT id, status, customer_id FROM invoices WHERE id = $1 FOR UPDATE',
    [replacementInvoiceId]
  );
  if (!replacement || replacement.id === original.id || replacement.status !== 'draft' || replacement.customer_id !== original.customer_id) {
    throw httpError(400, 'Die Ersatzrechnung muss ein Entwurf für denselben Kunden sein.');
  }
}

async function insertCancellation(client, original, invoiceNumber, issueDate, reason) {
  // Summen exakt negiert (kein Neuberechnen, keine Rundungsdifferenz). Feste Rabattwerte sind Beträge
  // und werden mitnegiert, Prozentwerte bleiben.
  const { rows: [{ id }] } = await client.query(
    `INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date,
       subtotal, tax_amount, total, status, notes,
       global_discount_type, global_discount_value, global_discount_amount,
       invoice_type, cancels_invoice_id, cancellation_reason, quota_counted_at)
     SELECT $1, customer_id, customer_name, $2, $2,
       -subtotal, -tax_amount, -total, 'cancelled', NULL,
       global_discount_type,
       CASE WHEN global_discount_type = 'fixed' THEN -global_discount_value ELSE global_discount_value END,
       -global_discount_amount,
       'cancellation', id, $3, NOW()
     FROM invoices WHERE id = $4
     RETURNING id`,
    [invoiceNumber, issueDate, reason, original.id]
  );
  await client.query(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order,
       discount_type, discount_value, discount_amount)
     SELECT $1, description, -quantity, unit_price, tax_rate, -total, item_order,
       discount_type,
       CASE WHEN discount_type = 'fixed' THEN -discount_value ELSE discount_value END,
       -discount_amount
     FROM invoice_items WHERE invoice_id = $2`,
    [id, original.id]
  );
  return id;
}

async function handleSources(client, originalId, { releaseSources, replacementInvoiceId }) {
  if (replacementInvoiceId) {
    await client.query('UPDATE job_entries SET invoice_id = $1, updated_at = NOW() WHERE invoice_id = $2', [replacementInvoiceId, originalId]);
    await client.query('UPDATE quotes SET converted_to_invoice_id = $1 WHERE converted_to_invoice_id = $2', [replacementInvoiceId, originalId]);
  } else if (releaseSources) {
    await client.query(
      "UPDATE job_entries SET invoice_id = NULL, status = 'completed', updated_at = NOW() WHERE invoice_id = $1",
      [originalId]
    );
    await client.query(
      "UPDATE quotes SET converted_to_invoice_id = NULL, status = 'accepted' WHERE converted_to_invoice_id = $1",
      [originalId]
    );
  }
}

/**
 * Storniert eine freigegebene Rechnung. Die Stornorechnung zählt nicht gegen das Kontingent.
 * Quellen (Aufträge, Angebot): releaseSources → wieder abrechenbar; replacementInvoiceId → auf den
 * neuen Entwurf umgehängt („Stornieren und neu erstellen“); sonst bleiben sie am Original.
 * Fehler: 400 (Eingabe), 404, 409 INVOICE_NOT_CANCELLABLE.
 */
export async function cancelInvoice(id, { reason, releaseSources = true, replacementInvoiceId = null } = {}) {
  validate(id, { reason, releaseSources, replacementInvoiceId });
  const trimmedReason = reason.trim();
  const issueDate = berlinDate();

  for (let attempt = 0; ; attempt++) {
    // Nummer vor der Transaktion (eigene Verbindung, wie createInvoice); bei Kollision neu.
    const invoiceNumber = await generateInvoiceNumber(issueDate, 'ST');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [original] } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
      if (!original) throw httpError(404, 'Rechnung nicht gefunden');
      if (original.invoice_type === 'cancellation') {
        throw httpError(409, 'Eine Stornorechnung kann nicht storniert werden.', 'INVOICE_NOT_CANCELLABLE');
      }
      if (original.status === 'draft') {
        throw httpError(409, 'Entwürfe können gelöscht werden und müssen nicht storniert werden.', 'INVOICE_NOT_CANCELLABLE');
      }
      if (original.status === 'cancelled') {
        throw httpError(409, 'Die Rechnung ist bereits storniert.', 'INVOICE_NOT_CANCELLABLE');
      }
      if (replacementInvoiceId) await assertReplacement(client, original, replacementInvoiceId);

      const cancellationId = await insertCancellation(client, original, invoiceNumber, issueDate, trimmedReason);
      await client.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [id]);
      await handleSources(client, id, { releaseSources, replacementInvoiceId });
      await client.query('COMMIT');

      return {
        original: await findInvoiceById(id),
        cancellation: await findInvoiceById(cancellationId),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505' && error.constraint === 'invoices_invoice_number_key' && attempt < MAX_ATTEMPTS - 1) continue;
      throw error;
    } finally {
      client.release();
    }
  }
}
