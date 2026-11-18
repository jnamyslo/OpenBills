// Archiv-Export: lesbares ZIP mit allen Archivfassungen, Anhängen, Kunden und Rechnungsjournal.
// Spec: docs/superpowers/specs/2026-11-17-document-archive-storno.md § 4

import AdmZip from 'adm-zip';
import { query } from '../database.js';
import { countMissing } from './archiveService.js';

const BOM = '﻿';
const SOURCE_REGENERATED = 'nachträglich erzeugt (Stammdaten Stand Export)';
const SOURCE_LABELS = { output: 'Ausgabe', regenerated: SOURCE_REGENERATED };
const FORMAT_LABELS = { pdf: 'PDF', zugferd: 'ZUGFeRD-PDF', xrechnung: 'XRechnung (XML)' };
const FORMAT_EXT = { pdf: '.pdf', zugferd: '.pdf', xrechnung: '.xml' };
const STATUS_LABELS = {
  draft: 'Entwurf', sent: 'Versendet', paid: 'Bezahlt', overdue: 'Überfällig',
  reminded_1x: '1x gemahnt', reminded_2x: '2x gemahnt', reminded_3x: '3x gemahnt', cancelled: 'Storniert',
  accepted: 'Angenommen', rejected: 'Abgelehnt', expired: 'Abgelaufen', billed: 'Abgerechnet',
};
const MAX_SEGMENT_LENGTH = 150;

/**
 * Ein Pfadbestandteil für das ZIP: keine Trenner, kein `..`, keine Steuerzeichen.
 * Erst beim ZIP-Bau angewendet; im Archiv bleibt der Originalname.
 */
export function sanitizePathSegment(name) {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '')
    .replace(/^[\s._]+|[\s._]+$/g, '')
    .slice(0, MAX_SEGMENT_LENGTH);
  return cleaned || 'datei';
}

function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV für Excel: UTF-8 mit BOM, Semikolon, CRLF. */
function toCsv(header, rows) {
  return BOM + [header, ...rows].map((row) => row.map(csvField).join(';')).join('\r\n') + '\r\n';
}

const money = (value) => (value === null || value === undefined ? '' : Number(value).toFixed(2).replace('.', ','));

/** Zeitraum-Bedingung auf eine Datumsspalte; Parameter ab `offset`. */
function periodWhere(column, { from, to }, values) {
  const where = [];
  if (from) { values.push(from); where.push(`${column} >= $${values.length}`); }
  if (to) { values.push(to); where.push(`${column} <= $${values.length}`); }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

/** Hängt bei Namensgleichheit `_2`, `_3` … vor der Endung an (Reihenfolge = Aufruf). */
function uniquePaths() {
  const used = new Set();
  return (path) => {
    if (!used.has(path)) { used.add(path); return path; }
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const [base, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
    for (let n = 2; ; n++) {
      const candidate = `${base}_${n}${ext}`;
      if (!used.has(candidate)) { used.add(candidate); return candidate; }
    }
  };
}

function archivePath(entry) {
  const number = sanitizePathSegment(entry.document_number);
  if (entry.document_type === 'reminder') {
    return `mahnungen/${number}_mahnung-${entry.reminder_stage}${FORMAT_EXT[entry.format]}`;
  }
  const folder = entry.document_type === 'quote' ? 'angebote' : 'rechnungen';
  return `${folder}/${number}/${sanitizePathSegment(entry.filename)}`;
}

function documentTypeLabel(entry) {
  if (entry.document_type === 'reminder') return `Mahnung Stufe ${entry.reminder_stage}`;
  if (entry.document_type === 'quote') return 'Angebot';
  return entry.invoice_type === 'cancellation' ? 'Stornorechnung' : 'Rechnung';
}

async function loadArchiveEntries(period) {
  const values = [];
  const where = periodWhere('a.issue_date', period, values);
  const { rows } = await query(
    `SELECT a.document_type, a.document_number, a.customer_name, a.total, a.reminder_stage, a.format,
       a.filename, a.sha256, a.source, a.content,
       to_char(a.issue_date, 'DD.MM.YYYY') AS issue_date,
       to_char(a.created_at AT TIME ZONE 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') AS archived_at,
       COALESCE(i.subtotal, q.subtotal) AS subtotal, COALESCE(i.tax_amount, q.tax_amount) AS tax_amount,
       COALESCE(i.status, q.status) AS status, i.invoice_type
     FROM document_archive a
     LEFT JOIN invoices i ON a.document_type IN ('invoice', 'reminder') AND i.id = a.document_id
     LEFT JOIN quotes q ON a.document_type = 'quote' AND q.id = a.document_id
     ${where}
     ORDER BY a.created_at, a.id`,
    values
  );
  return rows;
}

async function loadAttachments(period) {
  const values = [];
  const invoiceWhere = periodWhere('i.issue_date', period, values);
  const quoteWhere = periodWhere('q.issue_date', period, values);
  const and = (where) => (where ? `${where} AND` : 'WHERE');
  const { rows } = await query(
    `SELECT i.invoice_number AS number, att.name, att.content, att.uploaded_at
       FROM invoice_attachments att JOIN invoices i ON i.id = att.invoice_id
       ${and(invoiceWhere)} i.status <> 'draft'
     UNION ALL
     SELECT q.quote_number, att.name, att.content, att.uploaded_at
       FROM quote_attachments att JOIN quotes q ON q.id = att.quote_id
       ${and(quoteWhere)} q.status <> 'draft'
     ORDER BY number, uploaded_at`,
    values
  );
  return rows;
}

async function loadJournal(period) {
  const values = [];
  const where = periodWhere('i.issue_date', period, values);
  const { rows } = await query(
    `SELECT i.invoice_number, i.invoice_type, i.customer_name, i.subtotal, i.global_discount_amount, i.tax_amount,
       i.total, i.status, i.cancellation_reason,
       to_char(i.issue_date, 'DD.MM.YYYY') AS issue_date, to_char(i.due_date, 'DD.MM.YYYY') AS due_date,
       orig.invoice_number AS cancels_number, st.invoice_number AS cancelled_by_number
     FROM invoices i
     LEFT JOIN invoices orig ON orig.id = i.cancels_invoice_id
     LEFT JOIN invoices st ON st.cancels_invoice_id = i.id
     ${where}
     ORDER BY i.issue_date, i.invoice_number`,
    values
  );
  return rows;
}

async function loadCustomers() {
  const { rows } = await query(
    `SELECT customer_number, name, address, address_supplement, postal_code, city, country, email, phone, tax_id,
       to_char(created_at AT TIME ZONE 'Europe/Berlin', 'DD.MM.YYYY') AS created_at
     FROM customers ORDER BY customer_number`
  );
  return rows;
}

const germanDate = (iso) => iso.split('-').reverse().join('.');

function readme({ from, to }, { files, attachments, missing }) {
  const period = from || to
    ? `${from ? germanDate(from) : 'Beginn'} bis ${to ? germanDate(to) : 'heute'}`
    : 'alle Belege';
  const exportedAt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date());
  return [
    'OpenBills – Belegarchiv',
    '=======================',
    '',
    `Erstellt: ${exportedAt}`,
    `Zeitraum (Belegdatum): ${period}`,
    `Archivfassungen: ${files}, Anhänge: ${attachments}`,
    '',
    'Inhalt',
    '------',
    'index.csv             Verzeichnis aller Archivfassungen mit Betrag, Status, Quelle und SHA-256-Prüfsumme',
    'rechnungen/<Nummer>/  Rechnungen und Stornorechnungen (PDF, ZUGFeRD-PDF mit eingebettetem XML, XRechnung-XML)',
    'angebote/<Nummer>/    Angebote',
    'mahnungen/            Mahnungen (<Rechnungsnummer>_mahnung-<Stufe>.pdf)',
    'anhaenge/<Nummer>/    Anhänge zu Rechnungen und Angeboten',
    'kunden.csv            Kundenstammdaten (Stand Export)',
    'rechnungsjournal.csv  Alle Rechnungen im Zeitraum inkl. Entwürfen und Stornos mit Bezug',
    '',
    'Die CSV-Dateien sind UTF-8 mit Semikolon als Trennzeichen und lassen sich direkt mit Excel öffnen.',
    '',
    'Archivfassungen',
    '---------------',
    'Jede Datei ist die Originalfassung, wie sie beim Versenden oder Herunterladen ausgegeben wurde',
    '(Quelle "Ausgabe"). Wurde ein Beleg mehrfach in unterschiedlicher Form ausgegeben, sind alle',
    'Fassungen enthalten (Dateiname mit _2, _3 … in der Reihenfolge der Archivierung).',
    '',
    `Quelle "${SOURCE_REGENERATED}": Für Belege, die vor Einführung des Archivs`,
    'ausgegeben wurden, wurde die Datei nachträglich aus den gespeicherten Daten erzeugt. Der',
    'Rechnungsinhalt ist unverändert (freigegebene Rechnungen sind gesperrt), Kunden- und Firmendaten',
    '(z. B. Anschrift, Logo, Bankverbindung) entsprechen aber dem Stand zum Zeitpunkt der Erzeugung.',
    '',
    ...(missing > 0 ? [
      `Hinweis: ${missing} freigegebene Beleg(e) haben noch keine Archivfassung und fehlen in diesem Export.`,
      'Sie lassen sich in OpenBills unter Einstellungen → Daten → "Fehlende Fassungen erzeugen" nachholen.',
      '',
    ] : []),
    'Aufbewahrung',
    '------------',
    'Rechnungen und weitere Buchungsbelege unterliegen den gesetzlichen Aufbewahrungsfristen',
    '(§ 147 AO, § 257 HGB, GoBD). Bewahren Sie diesen Export unverändert und vollständig auf.',
    'Die SHA-256-Prüfsummen in index.csv belegen, dass die Dateien unverändert sind.',
    '',
  ].join('\r\n');
}

/** Baut das Archiv-ZIP. `from`/`to` (YYYY-MM-DD, optional) filtern nach Belegdatum. */
export async function buildArchiveZip({ from, to } = {}) {
  const period = { from, to };
  const [entries, attachments, journal, customers, missing] = await Promise.all([
    loadArchiveEntries(period), loadAttachments(period), loadJournal(period), loadCustomers(), countMissing(),
  ]);

  const zip = new AdmZip();
  const unique = uniquePaths();

  const indexRows = entries.map((entry) => {
    const path = unique(archivePath(entry));
    zip.addFile(path, Buffer.from(entry.content, 'base64'));
    const isReminder = entry.document_type === 'reminder';
    return [
      documentTypeLabel(entry), entry.document_number, entry.issue_date, entry.customer_name,
      isReminder ? '' : money(entry.subtotal), isReminder ? '' : money(entry.tax_amount), isReminder ? '' : money(entry.total),
      STATUS_LABELS[entry.status] ?? '', FORMAT_LABELS[entry.format], SOURCE_LABELS[entry.source],
      entry.archived_at, entry.sha256, path,
    ];
  });

  for (const attachment of attachments) {
    const path = unique(`anhaenge/${sanitizePathSegment(attachment.number)}/${sanitizePathSegment(attachment.name)}`);
    zip.addFile(path, Buffer.from(attachment.content.replace(/^data:[^,]*,/, ''), 'base64'));
  }

  zip.addFile('index.csv', Buffer.from(toCsv(
    ['Typ', 'Nummer', 'Datum', 'Kunde', 'Netto', 'USt', 'Brutto', 'Status', 'Format', 'Quelle', 'Archiviert am', 'SHA-256', 'Datei'],
    indexRows
  )));
  zip.addFile('kunden.csv', Buffer.from(toCsv(
    ['Kundennummer', 'Name', 'Adresse', 'Adresszusatz', 'PLZ', 'Ort', 'Land', 'E-Mail', 'Telefon', 'USt-ID', 'Angelegt am'],
    customers.map((c) => [c.customer_number, c.name, c.address, c.address_supplement, c.postal_code, c.city, c.country, c.email, c.phone, c.tax_id, c.created_at])
  )));
  zip.addFile('rechnungsjournal.csv', Buffer.from(toCsv(
    ['Nummer', 'Typ', 'Rechnungsdatum', 'Fällig am', 'Kunde', 'Netto', 'Rabatt', 'USt', 'Brutto', 'Status', 'Storno zu', 'Storniert durch', 'Stornogrund'],
    journal.map((i) => [
      i.invoice_number, i.invoice_type === 'cancellation' ? 'Stornorechnung' : 'Rechnung', i.issue_date, i.due_date, i.customer_name,
      money(i.subtotal), money(i.global_discount_amount), money(i.tax_amount), money(i.total), STATUS_LABELS[i.status] ?? i.status,
      i.cancels_number, i.cancelled_by_number, i.cancellation_reason,
    ])
  )));
  zip.addFile('LIESMICH.txt', Buffer.from(readme(period, {
    files: entries.length,
    attachments: attachments.length,
    missing: missing.invoices.length + missing.quotes.length,
  })));

  return zip.toBuffer();
}
