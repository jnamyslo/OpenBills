import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN, waitForAudit } from './helpers/auth.js';

const mail = vi.hoisted(() => ({
  sendInvoiceEmail: vi.fn(async () => ({ messageId: 'm1' })),
  sendInvoiceEmailMultiFormat: vi.fn(async () => ({ messageId: 'm2' })),
  sendReminderEmail: vi.fn(async () => ({ success: true })),
  sendQuoteEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('../services/emailService.js', async (importOriginal) => ({ ...(await importOriginal()), ...mail }));

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

async function clearArchive() {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE document_archive DISABLE TRIGGER document_archive_append_only');
    try {
      await client.query('DELETE FROM document_archive');
    } finally {
      await client.query('ALTER TABLE document_archive ENABLE TRIGGER document_archive_append_only');
    }
  } finally {
    client.release();
  }
}

describe.skipIf(!hasDb)('Belegarchiv', () => {
  let cookie;
  let customerId;
  let invoiceId;
  let draftId;
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
    vi.clearAllMocks();
    await resetAuthTables();
    await clearArchive();
    await pool.query('TRUNCATE quote_responses, job_entries, quote_items, quotes, invoice_items, invoices, customers CASCADE');
    ({ cookie } = await loginAs('user'));
    ({ rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, email, address, city, postal_code, country, customer_number)
       VALUES ('Kunde GmbH', 'k@test.example', 'Str. 2', 'Berlin', '10115', 'Deutschland', 'K-1') RETURNING id`
    ));
    const insertInvoice = (number, status) => pool.query(
      `INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status)
       VALUES ($1, $2, 'Kunde GmbH', '2026-11-18', '2026-12-02', 100, 19, 119, $3) RETURNING id`,
      [number, customerId, status]
    ).then((r) => r.rows[0].id);
    invoiceId = await insertInvoice('RE-2026-001', 'sent');
    draftId = await insertInvoice('RE-2026-002', 'draft');
    ({ rows: [{ id: quoteId }] } = await pool.query(
      `INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status)
       VALUES ('AN-2026-001', $1, 'Kunde GmbH', '2026-11-18', '2026-12-18', 100, 19, 119, 'sent') RETURNING id`,
      [customerId]
    ));
  });

  const upload = (body) => request(app).post('/api/archive').set('Cookie', cookie).set(ORIGIN).send({
    documentType: 'invoice',
    documentId: invoiceId,
    format: 'zugferd',
    filename: 'RE-2026-001.pdf',
    contentType: 'application/pdf',
    content: PDF,
    ...body,
  });

  it('legt eine Fassung mit Schnappschuss an und dedupliziert gleiche Dateien', async () => {
    const first = await upload();
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ created: true });
    const second = await upload();
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ id: first.body.id, created: false });
    const changed = await upload({ content: Buffer.from('%PDF-1.4 anders').toString('base64') });
    expect(changed.body.created).toBe(true);

    const { rows } = await pool.query('SELECT * FROM document_archive WHERE id = $1', [first.body.id]);
    expect(rows[0]).toMatchObject({
      document_number: 'RE-2026-001',
      customer_name: 'Kunde GmbH',
      total: '119.00',
      size: Buffer.from(PDF, 'base64').length,
      source: 'output',
    });
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].created_by).not.toBeNull();
  });

  it('lehnt Entwürfe (409), unbekannte Belege (404) und ungültige Angaben (400) ab', async () => {
    expect((await upload({ documentId: draftId })).status).toBe(409);
    expect((await upload({ documentId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
    expect((await upload({ format: 'docx' })).status).toBe(400);
    expect((await upload({ documentType: 'reminder' })).status).toBe(400); // Mahnstufe fehlt
    expect((await upload({ content: '' })).status).toBe(400);
    expect((await upload({ source: 'foo' })).status).toBe(400);
  });

  it('listet Fassungen ohne Inhalt und liefert den Download mit Audit', async () => {
    const { body: { id } } = await upload();
    const list = await request(app).get(`/api/archive?documentType=invoice&documentId=${invoiceId}`).set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, documentNumber: 'RE-2026-001', format: 'zugferd', filename: 'RE-2026-001.pdf' });
    expect(list.body[0]).not.toHaveProperty('content');

    const file = await request(app).get(`/api/archive/${id}/download`).set('Cookie', cookie).buffer(true)
      .parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/pdf/);
    expect(file.headers['content-disposition']).toContain('RE-2026-001.pdf');
    expect(file.body.equals(Buffer.from(PDF, 'base64'))).toBe(true);
    const audits = await waitForAudit('archive.downloaded');
    expect(audits[0].entity_id).toBe(id);

    expect((await request(app).get('/api/archive/00000000-0000-0000-0000-000000000000/download').set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).get('/api/archive/kein-uuid/download').set('Cookie', cookie)).status).toBe(404);
  });

  it('meldet freigegebene Belege ohne PDF-Fassung', async () => {
    const before = await request(app).get('/api/archive/missing').set('Cookie', cookie);
    expect(before.body).toEqual({ invoices: [invoiceId], quotes: [quoteId] });
    await upload();
    await upload({ documentType: 'quote', documentId: quoteId, format: 'pdf', filename: 'AN-2026-001.pdf' });
    const after = await request(app).get('/api/archive/missing').set('Cookie', cookie);
    expect(after.body).toEqual({ invoices: [], quotes: [] });
  });

  describe('Mailversand', () => {
    const invoiceData = () => ({ id: invoiceId, invoiceNumber: 'RE-2026-001', customerName: 'Kunde GmbH' });
    const archived = () => pool.query('SELECT document_type, document_id, format, filename, reminder_stage FROM document_archive ORDER BY format');

    it('send-invoice-multi archiviert jede Datei einzeln', async () => {
      const res = await request(app).post('/api/email/send-invoice-multi').set('Cookie', cookie).set(ORIGIN).send({
        customerEmails: ['k@test.example'],
        invoiceFormats: [{ format: 'zugferd', content: PDF }, { format: 'xrechnung', content: XML }],
        invoiceData: invoiceData(),
      });
      expect(res.status).toBe(200);
      const { rows } = await archived();
      expect(rows).toEqual([
        { document_type: 'invoice', document_id: invoiceId, format: 'xrechnung', filename: 'XRechnung_RE-2026-001.xml', reminder_stage: null },
        { document_type: 'invoice', document_id: invoiceId, format: 'zugferd', filename: 'Rechnung_RE-2026-001.pdf', reminder_stage: null },
      ]);
    });

    it('archiviert Entwürfe nie', async () => {
      const res = await request(app).post('/api/email/send-invoice-multi').set('Cookie', cookie).set(ORIGIN).send({
        customerEmails: ['k@test.example'],
        invoiceFormats: [{ format: 'zugferd', content: PDF }],
        invoiceData: { ...invoiceData(), id: draftId },
      });
      expect(res.status).toBe(200);
      expect(mail.sendInvoiceEmailMultiFormat).toHaveBeenCalled();
      expect((await archived()).rows).toEqual([]);
    });

    it('archiviert nicht, wenn kein Empfänger erreicht wurde', async () => {
      mail.sendInvoiceEmailMultiFormat.mockRejectedValueOnce(new Error('SMTP down'));
      await request(app).post('/api/email/send-invoice-multi').set('Cookie', cookie).set(ORIGIN).send({
        customerEmails: ['k@test.example'],
        invoiceFormats: [{ format: 'zugferd', content: PDF }],
        invoiceData: invoiceData(),
      });
      expect((await archived()).rows).toEqual([]);
    });

    it('send-invoice archiviert die Datei', async () => {
      const res = await request(app).post('/api/email/send-invoice').set('Cookie', cookie).set(ORIGIN).send({
        customerEmail: 'k@test.example', invoicePDF: XML, invoiceData: invoiceData(), format: 'xrechnung',
      });
      expect(res.status).toBe(200);
      expect((await archived()).rows).toMatchObject([{ format: 'xrechnung', filename: 'XRechnung_RE-2026-001.xml' }]);
    });

    it('send-reminder archiviert die Mahnung mit Stufe', async () => {
      const res = await request(app).post('/api/email/send-reminder').set('Cookie', cookie).set(ORIGIN).send({
        customerEmails: ['k@test.example'], reminderPDF: PDF, invoiceData: invoiceData(), stage: 2,
      });
      expect(res.status).toBe(200);
      expect((await archived()).rows).toMatchObject([{ document_type: 'reminder', document_id: invoiceId, format: 'pdf', reminder_stage: 2 }]);
    });

    it('Angebotsversand archiviert das PDF, Entwurf nicht', async () => {
      const res = await request(app).post(`/api/quotes/${quoteId}/send-email`).set('Cookie', cookie).set(ORIGIN)
        .send({ customerEmails: ['k@test.example'], pdfBuffer: PDF });
      expect(res.status).toBe(200);
      expect((await archived()).rows).toMatchObject([{ document_type: 'quote', document_id: quoteId, format: 'pdf', filename: 'Angebot_AN-2026-001.pdf' }]);

      await pool.query("UPDATE quotes SET status = 'draft' WHERE id = $1", [quoteId]);
      await request(app).post(`/api/quotes/${quoteId}/send-email`).set('Cookie', cookie).set(ORIGIN)
        .send({ customerEmails: ['k@test.example'], pdfBuffer: PDF_2 });
      expect((await archived()).rows).toHaveLength(1);
    });
  });
});
