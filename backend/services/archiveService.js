// Belegarchiv: Originalfassungen ausgegebener Belege (append-only, siehe Migration 015).
// Spec: docs/superpowers/specs/2026-11-17-document-archive-storno.md

import crypto from 'crypto';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const DOCUMENT_TYPES = ['invoice', 'quote', 'reminder'];
const FORMATS = ['pdf', 'zugferd', 'xrechnung'];
const SOURCES = ['output', 'regenerated'];

const SNAPSHOT_SQL = {
  invoice: 'SELECT invoice_number AS number, customer_name, issue_date, total, status FROM invoices WHERE id = $1',
  reminder: 'SELECT invoice_number AS number, customer_name, issue_date, total, status FROM invoices WHERE id = $1',
  quote: 'SELECT quote_number AS number, customer_name, issue_date, total, status FROM quotes WHERE id = $1',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_COLUMNS = `id, document_type, document_id, document_number, customer_name, issue_date, total,
  reminder_stage, format, filename, content_type, size, sha256, source, created_at, created_by`;

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function toApi(row) {
  return {
    id: row.id,
    documentType: row.document_type,
    documentId: row.document_id,
    documentNumber: row.document_number,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    total: row.total === null ? null : Number(row.total),
    reminderStage: row.reminder_stage,
    format: row.format,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    sha256: row.sha256,
    source: row.source,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function validate({ documentType, documentId, format, filename, contentType, contentBase64, source, reminderStage }) {
  if (!DOCUMENT_TYPES.includes(documentType)) throw httpError(400, 'Ungültiger Belegtyp');
  if (typeof documentId !== 'string' || !UUID_RE.test(documentId)) throw httpError(400, 'Ungültige Beleg-ID');
  if (!FORMATS.includes(format)) throw httpError(400, 'Ungültiges Format');
  if (!SOURCES.includes(source)) throw httpError(400, 'Ungültige Quelle');
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 255) throw httpError(400, 'Ungültiger Dateiname');
  if (typeof contentType !== 'string' || !contentType.trim() || contentType.length > 100) throw httpError(400, 'Ungültiger Dateityp');
  if (typeof contentBase64 !== 'string' || !contentBase64) throw httpError(400, 'Datei fehlt');
  if (documentType === 'reminder') {
    if (![1, 2, 3].includes(reminderStage)) throw httpError(400, 'Ungültige Mahnstufe');
  } else if (reminderStage !== undefined && reminderStage !== null) {
    throw httpError(400, 'Mahnstufe nur bei Mahnungen');
  }
}

/**
 * Legt eine Fassung ab. Nummer, Kunde, Datum und Summe werden als Schnappschuss aus der DB gelesen.
 * Wirft 400 (ungültig), 404 (unbekannter Beleg), 409 (Entwurf).
 */
export async function archiveDocument(client, params) {
  validate(params);
  const { documentType, documentId, format, filename, contentType, contentBase64, source, reminderStage = null, userId = null } = params;
  const run = client ? (sql, values) => client.query(sql, values) : query;

  const { rows: [doc] } = await run(SNAPSHOT_SQL[documentType], [documentId]);
  if (!doc) throw httpError(404, 'Beleg nicht gefunden');
  if (doc.status === 'draft') throw httpError(409, 'Entwürfe werden nicht archiviert');

  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length === 0) throw httpError(400, 'Datei fehlt');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const inserted = await run(
    `INSERT INTO document_archive (document_type, document_id, document_number, customer_name, issue_date, total,
       reminder_stage, format, filename, content_type, size, content, sha256, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (document_type, document_id, format, sha256) DO NOTHING
     RETURNING id`,
    [documentType, documentId, doc.number, doc.customer_name, doc.issue_date, doc.total,
      reminderStage, format, filename.trim(), contentType.trim(), buffer.length, buffer.toString('base64'), sha256, source, userId]
  );
  if (inserted.rows.length > 0) return { id: inserted.rows[0].id, created: true };

  const { rows: [existing] } = await run(
    'SELECT id FROM document_archive WHERE document_type = $1 AND document_id = $2 AND format = $3 AND sha256 = $4',
    [documentType, documentId, format, sha256]
  );
  return { id: existing.id, created: false };
}

/** Für Mailrouten: archiviert nach erfolgreichem Versand; Fehler lassen den Versand nicht scheitern. */
export async function archiveSentFiles(files, userId) {
  for (const file of files) {
    try {
      await archiveDocument(null, { ...file, source: 'output', userId });
    } catch (error) {
      logger.error('Versendeter Beleg konnte nicht archiviert werden', {
        documentType: file.documentType, documentId: file.documentId, format: file.format, error: error.message,
      });
    }
  }
}

export async function listArchive({ documentType, documentId } = {}) {
  const where = [];
  const values = [];
  if (documentType) {
    values.push(documentType);
    where.push(`document_type = $${values.length}`);
  }
  if (documentId) {
    if (!UUID_RE.test(documentId)) return [];
    values.push(documentId);
    where.push(`document_id = $${values.length}`);
  }
  const { rows } = await query(
    `SELECT ${LIST_COLUMNS} FROM document_archive ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC`,
    values
  );
  return rows.map(toApi);
}

export async function getArchiveFile(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const { rows: [row] } = await query(`SELECT ${LIST_COLUMNS}, content FROM document_archive WHERE id = $1`, [id]);
  return row ? { ...toApi(row), content: Buffer.from(row.content, 'base64') } : null;
}

/** Freigegebene Belege ohne PDF-Fassung (bei Rechnungen zählt auch ZUGFeRD-PDF). */
export async function countMissing() {
  const invoices = await query(
    `SELECT i.id FROM invoices i
     WHERE i.status <> 'draft' AND NOT EXISTS (
       SELECT 1 FROM document_archive a
       WHERE a.document_type = 'invoice' AND a.document_id = i.id AND a.format IN ('pdf', 'zugferd'))
     ORDER BY i.issue_date, i.invoice_number`
  );
  const quotes = await query(
    `SELECT q.id FROM quotes q
     WHERE q.status <> 'draft' AND NOT EXISTS (
       SELECT 1 FROM document_archive a
       WHERE a.document_type = 'quote' AND a.document_id = q.id AND a.format = 'pdf')
     ORDER BY q.issue_date, q.quote_number`
  );
  return { invoices: invoices.rows.map((r) => r.id), quotes: quotes.rows.map((r) => r.id) };
}
