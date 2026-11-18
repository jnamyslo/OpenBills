import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';
import { archiveDocument } from '../services/archiveService.js';

const app = createApp();

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

describe.skipIf(!hasDb)('Sperre freigegebener Rechnungen', () => {
  let cookie;
  let customerId;

  const put = (id, body) => request(app).put(`/api/invoices/${id}`).set('Cookie', cookie).set(ORIGIN).send(body);
  const del = (id) => request(app).delete(`/api/invoices/${id}`).set('Cookie', cookie).set(ORIGIN);
  const get = (id) => request(app).get(`/api/invoices/${id}`).set('Cookie', cookie);
  const expectLocked = (res) => {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVOICE_LOCKED');
    expect(res.body.error).toEqual(expect.any(String));
  };

  async function createInvoice(status = 'sent') {
    const res = await request(app).post('/api/invoices').set('Cookie', cookie).set(ORIGIN).send({
      customerId,
      issueDate: '2026-11-18',
      dueDate: '2026-12-02',
      notes: 'Danke',
      globalDiscountType: 'percentage',
      globalDiscountValue: 10,
      globalDiscountAmount: 15,
      items: [
        { description: 'Montage', quantity: 2, unitPrice: 50, taxRate: 19, discountType: 'fixed', discountValue: 5, discountAmount: 5 },
        { description: 'Material', quantity: 1.5, unitPrice: 40, taxRate: 7 },
      ],
      attachments: [{ name: 'plan.pdf', content: 'YWJj', contentType: 'application/pdf', size: 3 }],
    });
    expect(res.status).toBe(201);
    if (status !== 'draft') expect((await put(res.body.id, { status })).status).toBe(200);
    return res.body.id;
  }

  async function itemAndAttachmentIds(id) {
    const items = await pool.query('SELECT id FROM invoice_items WHERE invoice_id = $1 ORDER BY item_order', [id]);
    const atts = await pool.query('SELECT id, content FROM invoice_attachments WHERE invoice_id = $1', [id]);
    return { items: items.rows, attachments: atts.rows };
  }

  beforeAll(migrateTestDb);
  afterAll(async () => {
    await clearArchive();
    await pool.end();
  });

  beforeEach(async () => {
    await resetAuthTables();
    await clearArchive();
    await pool.query('TRUNCATE job_entries, quotes, invoice_items, invoice_attachments, invoices, customers CASCADE');
    ({ cookie } = await loginAs('user'));
    ({ rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, address, city, postal_code, country, customer_number)
       VALUES ('Kunde GmbH', 'Str. 2', 'Berlin', '10115', 'Deutschland', 'K-1') RETURNING id`
    ));
  });

  it('Entwürfe bleiben frei bearbeitbar', async () => {
    const id = await createInvoice('draft');
    const res = await put(id, { notes: 'Neu', items: [{ description: 'X', quantity: 1, unitPrice: 10, taxRate: 19 }] });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('Neu');
  });

  it('verweigert Änderungen an Positionen, Text, Datum und Summen', async () => {
    const id = await createInvoice();
    const { body: invoice } = await get(id);
    expectLocked(await put(id, { items: [{ ...invoice.items[0], quantity: 3 }, invoice.items[1]] }));
    expectLocked(await put(id, { items: [invoice.items[0]] }));
    expectLocked(await put(id, { notes: 'Geändert' }));
    expectLocked(await put(id, { dueDate: '2026-12-24' }));
    expectLocked(await put(id, { total: 1 }));
    expectLocked(await put(id, { attachments: [] }));
    expectLocked(await put(id, { attachments: [...invoice.attachments, { name: 'neu.pdf', content: 'YQ==', contentType: 'application/pdf', size: 1 }] }));
    expect((await get(id)).body).toEqual(invoice);
  });

  it('erlaubt Statuswechsel mit vollem Frontend-Objekt (Detail- und Listenform) und lässt Positionen/Anhänge unberührt', async () => {
    const id = await createInvoice();
    const before = await itemAndAttachmentIds(id);

    // Editor: Objekt aus GET /:id, Datum als Date-Objekt (JSON → ISO-String), Anhänge ohne content
    const { body: detail } = await get(id);
    const editorPayload = JSON.parse(JSON.stringify({
      ...detail,
      issueDate: new Date(detail.issueDate),
      dueDate: new Date('2026-12-02'),
      attachments: detail.attachments.map(({ content: _c, ...a }) => a),
      status: 'paid',
    }));
    const res = await put(id, editorPayload);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');

    // Liste: GET /api/invoices (mit Rabattfeldern an den Positionen, ohne Anhang-Inhalt)
    const { body: list } = await request(app).get('/api/invoices').set('Cookie', cookie);
    const fromList = list.find((i) => i.id === id);
    expect((await put(id, { ...fromList, status: 'sent' })).status).toBe(200);

    expect(await itemAndAttachmentIds(id)).toEqual(before);
    expect((await get(id)).body.attachments[0].content).toBe('YWJj');
  });

  it('erlaubt Statuswechsel zwischen freigegebenen Status', async () => {
    const id = await createInvoice();
    for (const status of ['overdue', 'reminded_1x', 'paid', 'sent']) {
      const res = await put(id, { status });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  it('Rückweg auf Entwurf nur ohne Archivfassung', async () => {
    const id = await createInvoice();
    expect((await put(id, { status: 'draft' })).status).toBe(200);
    expect((await put(id, { status: 'sent' })).status).toBe(200);

    await archiveDocument(null, {
      documentType: 'invoice', documentId: id, format: 'zugferd', filename: 'r.pdf',
      contentType: 'application/pdf', contentBase64: 'JVBERg==', source: 'output',
    });
    expectLocked(await put(id, { status: 'draft' }));
    expect((await get(id)).body.status).toBe('sent');
  });

  it('Status cancelled nie per PUT; stornierte Rechnungen sind komplett gesperrt', async () => {
    const id = await createInvoice();
    expectLocked(await put(id, { status: 'cancelled' }));
    const draftId = await createInvoice('draft');
    expectLocked(await put(draftId, { status: 'cancelled' }));

    await pool.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [id]);
    expectLocked(await put(id, { status: 'sent' }));
    expectLocked(await put(id, { status: 'cancelled' }));
    expectLocked(await put(id, {}));
  });

  it('Kunde mit freigegebener oder stornierter Rechnung lässt sich nicht löschen', async () => {
    const delCustomer = () => request(app).delete(`/api/customers/${customerId}`).set('Cookie', cookie).set(ORIGIN);
    const invoiceId = await createInvoice();
    let res = await delCustomer();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CUSTOMER_HAS_INVOICES');
    expect((await get(invoiceId)).status).toBe(200);

    await pool.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [invoiceId]);
    expect((await delCustomer()).status).toBe(409);

    // nur Entwürfe: Löschen wie bisher (Entwürfe gehen mit)
    await pool.query("UPDATE invoices SET status = 'draft' WHERE id = $1", [invoiceId]);
    res = await delCustomer();
    expect(res.status).toBe(200);
    expect((await get(invoiceId)).status).toBe(404);
    expect((await delCustomer()).status).toBe(404);
  });

  it('Löschen nur für Entwürfe', async () => {
    const sent = await createInvoice();
    expectLocked(await del(sent));
    expect((await get(sent)).status).toBe(200);

    const draft = await createInvoice('draft');
    expect((await del(draft)).status).toBe(200);
    expect((await del(draft)).status).toBe(404);
  });
});
