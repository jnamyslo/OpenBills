import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { PDFDocument } from 'pdf-lib';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { archiveDocument } from '../services/archiveService.js';
import { buildArchiveZip, sanitizePathSegment } from '../services/archiveExportService.js';
import { loginAs, ORIGIN, waitForAudit } from './helpers/auth.js';

const { createApp } = await import('../app.js');
const app = createApp();

async function makePdf(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save()).toString('base64');
}
const PDF = await makePdf();
const PDF_2 = await makePdf(2);
const XML = Buffer.from('<Invoice/>').toString('base64');
const BOM = '﻿';

async function clearArchive() {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE document_archive DISABLE TRIGGER document_archive_append_only');
    await client.query('DELETE FROM document_archive');
    await client.query('ALTER TABLE document_archive ENABLE TRIGGER document_archive_append_only');
  } finally {
    client.release();
  }
}

const csv = (zip, name) => zip.getEntry(name)?.getData().toString('utf8');
/** Minimaler CSV-Parser (Semikolon, Anführungszeichen, CRLF). */
function rows(text) {
  const out = [];
  let row = [];
  let field = '';
  let quoted = false;
  const body = text.replace(BOM, '');
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\r' && body[i + 1] === '\n') { row.push(field); out.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  if (field || row.length) { row.push(field); out.push(row); }
  return out;
}

describe('sanitizePathSegment', () => {
  it('entfernt Pfadtrenner, ".." und Steuerzeichen', () => {
    expect(sanitizePathSegment('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizePathSegment('a\\b/c')).toBe('a_b_c');
    expect(sanitizePathSegment('..')).toBe('datei');
    expect(sanitizePathSegment('re\u0000chnung.pdf')).toBe('rechnung.pdf');
    expect(sanitizePathSegment('RE-2026-001.pdf')).toBe('RE-2026-001.pdf');
  });
});

describe.skipIf(!hasDb)('Archiv-Export', () => {
  let adminCookie;
  let invoiceId;
  let draftId;
  let cancellationId;
  let quoteId;

  beforeAll(async () => {
    await migrateTestDb();
    await pool.query(
      `INSERT INTO company (id, name, address, city, postal_code, country, phone, email, tax_id)
       VALUES (1, 'Testfirma', 'Str. 1', 'Berlin', '10115', 'Deutschland', '0', 'a@b.de', 'DE1')
       ON CONFLICT (id) DO NOTHING`
    );
  });
  afterAll(async () => {
    await clearArchive();
    await pool.end();
  });

  beforeEach(async () => {
    await resetAuthTables();
    await clearArchive();
    await pool.query('TRUNCATE quote_responses, job_entries, quote_items, quote_attachments, quotes, invoice_items, invoice_attachments, invoices, customers CASCADE');
    ({ cookie: adminCookie } = await loginAs('admin'));
    const { rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, email, address, city, postal_code, country, customer_number, tax_id)
       VALUES ('Kunde; "GmbH"', 'k@test.example', 'Str. 2', 'Berlin', '10115', 'Deutschland', 'K-1', 'DE999') RETURNING id`
    );
    const insertInvoice = (number, status, issueDate, extra = {}) => pool.query(
      `INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status,
         invoice_type, cancels_invoice_id, cancellation_reason, global_discount_amount)
       VALUES ($1, $2, 'Kunde; "GmbH"', $3, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [number, customerId, issueDate, extra.subtotal ?? 100, extra.tax ?? 19, extra.total ?? 119, status,
        extra.type ?? 'invoice', extra.cancels ?? null, extra.reason ?? null, extra.discount ?? null]
    ).then((r) => r.rows[0].id);
    invoiceId = await insertInvoice('RE-2026-001', 'cancelled', '2026-03-10', { subtotal: 1234.5, tax: 234.56, total: 1469.06, discount: 10 });
    draftId = await insertInvoice('RE-2026-002', 'draft', '2026-03-11');
    cancellationId = await insertInvoice('ST-2026-001', 'cancelled', '2026-11-18', {
      subtotal: -1234.5, tax: -234.56, total: -1469.06, type: 'cancellation', cancels: invoiceId, reason: 'Falscher Betrag',
    });
    await insertInvoice('RE-2025-007', 'paid', '2025-12-30');
    ({ rows: [{ id: quoteId }] } = await pool.query(
      `INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status)
       VALUES ('AN-2026-001', $1, 'Kunde GmbH', '2026-02-01', '2026-03-01', 100, 19, 119, 'accepted') RETURNING id`,
      [customerId]
    ));
    await pool.query(
      `INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size) VALUES ($1, '../Plan.pdf', $2, 'application/pdf', 3)`,
      [invoiceId, Buffer.from('abc').toString('base64')]
    );

    const archive = (params) => archiveDocument(null, { source: 'output', userId: null, ...params });
    await archive({ documentType: 'invoice', documentId: invoiceId, format: 'zugferd', filename: 'RE-2026-001.pdf', contentBase64: PDF });
    await archive({ documentType: 'invoice', documentId: invoiceId, format: 'zugferd', filename: 'RE-2026-001.pdf', contentBase64: PDF_2 });
    await archive({ documentType: 'invoice', documentId: invoiceId, format: 'xrechnung', filename: 'RE-2026-001_xrechnung.xml', contentBase64: XML });
    await archive({ documentType: 'invoice', documentId: cancellationId, format: 'zugferd', filename: 'ST-2026-001.pdf', contentBase64: PDF, source: 'regenerated' });
    await archive({ documentType: 'reminder', documentId: invoiceId, reminderStage: 1, format: 'pdf', filename: 'Mahnung-1_RE-2026-001.pdf', contentBase64: PDF });
    await archive({ documentType: 'quote', documentId: quoteId, format: 'pdf', filename: '../../Angebot_AN-2026-001.pdf', contentBase64: PDF });
  });

  it('baut die Ordnerstruktur mit allen Fassungen (Suffix _2 nach Archivierungszeit)', async () => {
    const zip = new AdmZip(await buildArchiveZip({}));
    const names = zip.getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual([
      'LIESMICH.txt',
      'angebote/AN-2026-001/Angebot_AN-2026-001.pdf',
      'anhaenge/RE-2026-001/Plan.pdf',
      'index.csv',
      'kunden.csv',
      'mahnungen/RE-2026-001_mahnung-1.pdf',
      'rechnungen/RE-2026-001/RE-2026-001.pdf',
      'rechnungen/RE-2026-001/RE-2026-001_2.pdf',
      'rechnungen/RE-2026-001/RE-2026-001_xrechnung.xml',
      'rechnungen/ST-2026-001/ST-2026-001.pdf',
      'rechnungsjournal.csv',
    ]);
    const first = zip.getEntry('rechnungen/RE-2026-001/RE-2026-001.pdf').getData();
    expect(first.toString('base64')).toBe(PDF);
    expect(zip.getEntry('LIESMICH.txt').getData().toString('utf8')).toContain('nachträglich erzeugt');
  });

  it('CSV: UTF-8 mit BOM, Semikolon, Dezimalkomma, TT.MM.JJJJ, Quelle', async () => {
    const zip = new AdmZip(await buildArchiveZip({}));
    const index = csv(zip, 'index.csv');
    expect(index.startsWith(BOM)).toBe(true);
    const [head, ...lines] = rows(index);
    expect(head).toEqual(['Typ', 'Nummer', 'Datum', 'Kunde', 'Netto', 'USt', 'Brutto', 'Status', 'Format', 'Quelle', 'Archiviert am', 'SHA-256', 'Datei']);
    const original = lines.find((l) => l[12] === 'rechnungen/RE-2026-001/RE-2026-001.pdf');
    expect(original.slice(0, 10)).toEqual([
      'Rechnung', 'RE-2026-001', '10.03.2026', 'Kunde; "GmbH"', '1234,50', '234,56', '1469,06', 'Storniert', 'ZUGFeRD-PDF', 'Ausgabe',
    ]);
    const storno = lines.find((l) => l[1] === 'ST-2026-001');
    expect(storno[0]).toBe('Stornorechnung');
    expect(storno[6]).toBe('-1469,06');
    expect(storno[9]).toBe('nachträglich erzeugt (Stammdaten Stand Export)');
    expect(lines.find((l) => l[0] === 'Mahnung Stufe 1')[12]).toBe('mahnungen/RE-2026-001_mahnung-1.pdf');

    const kunden = rows(csv(zip, 'kunden.csv'));
    expect(csv(zip, 'kunden.csv').startsWith(BOM)).toBe(true);
    expect(kunden[0]).toEqual(['Kundennummer', 'Name', 'Adresse', 'Adresszusatz', 'PLZ', 'Ort', 'Land', 'E-Mail', 'Telefon', 'USt-ID', 'Angelegt am']);
    expect(kunden[1].slice(0, 2)).toEqual(['K-1', 'Kunde; "GmbH"']);
    expect(csv(zip, 'kunden.csv')).toContain('"Kunde; ""GmbH"""');
  });

  it('Rechnungsjournal enthält alle Rechnungen inkl. Entwurf und Storno mit Bezug', async () => {
    const zip = new AdmZip(await buildArchiveZip({}));
    const [head, ...lines] = rows(csv(zip, 'rechnungsjournal.csv'));
    expect(head).toEqual(['Nummer', 'Typ', 'Rechnungsdatum', 'Fällig am', 'Kunde', 'Netto', 'Rabatt', 'USt', 'Brutto', 'Status', 'Storno zu', 'Storniert durch', 'Stornogrund']);
    expect(lines.map((l) => l[0])).toEqual(['RE-2025-007', 'RE-2026-001', 'RE-2026-002', 'ST-2026-001']);
    const original = lines[1];
    expect(original[6]).toBe('10,00');
    expect(original[11]).toBe('ST-2026-001');
    const storno = lines[3];
    expect([storno[1], storno[10], storno[12]]).toEqual(['Stornorechnung', 'RE-2026-001', 'Falscher Betrag']);
    expect(lines[2][9]).toBe('Entwurf');
  });

  it('filtert nach Belegdatum (von/bis)', async () => {
    const zip = new AdmZip(await buildArchiveZip({ from: '2026-03-01', to: '2026-03-31' }));
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('rechnungen/RE-2026-001/RE-2026-001.pdf');
    expect(names).toContain('mahnungen/RE-2026-001_mahnung-1.pdf');
    expect(names.some((n) => n.startsWith('angebote/'))).toBe(false);
    expect(names.some((n) => n.startsWith('rechnungen/ST-'))).toBe(false);
    expect(rows(csv(zip, 'rechnungsjournal.csv')).slice(1).map((l) => l[0])).toEqual(['RE-2026-001', 'RE-2026-002']);
    expect(zip.getEntry('LIESMICH.txt').getData().toString('utf8')).toContain('01.03.2026 bis 31.03.2026');
  });

  describe('GET /api/archive/export', () => {
    it('liefert das ZIP an Admins und protokolliert den Export', async () => {
      const res = await request(app).get('/api/archive/export?from=2026-01-01&to=2026-12-31')
        .set('Cookie', adminCookie).buffer(true).parse((r, cb) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toMatch(/filename\*=UTF-8''openbills-archiv_Testfirma_\d{4}-\d{2}-\d{2}\.zip/);
      expect(new AdmZip(res.body).getEntry('index.csv')).toBeTruthy();
      const audits = await waitForAudit('archive.exported');
      expect(audits[0].details).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    });

    it('verweigert Nicht-Admins (403)', async () => {
      const { cookie } = await loginAs('user');
      const res = await request(app).get('/api/archive/export').set('Cookie', cookie);
      expect(res.status).toBe(403);
    });

    it('lehnt ungültige Zeiträume ab (400)', async () => {
      const res = await request(app).get('/api/archive/export?from=gestern').set('Cookie', adminCookie);
      expect(res.status).toBe(400);
    });
  });

  it('exportiert keine Fassungen von Entwürfen (es gibt keine) und bleibt bei leerem Archiv gültig', async () => {
    await clearArchive();
    const zip = new AdmZip(await buildArchiveZip({}));
    expect(rows(csv(zip, 'index.csv'))).toHaveLength(1);
    expect(draftId).toBeTruthy();
  });
});
