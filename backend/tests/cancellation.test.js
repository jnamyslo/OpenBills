import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN, waitForAudit } from './helpers/auth.js';
import { createApp } from '../app.js';
import { currentPeriod } from '../utils/plan.js';

const app = createApp();
const YEAR = new Date().getFullYear();

describe.skipIf(!hasDb)('Storno', () => {
  let cookie;
  let customerId;

  const post = (url, body) => request(app).post(url).set('Cookie', cookie).set(ORIGIN).send(body);
  const put = (id, body) => request(app).put(`/api/invoices/${id}`).set('Cookie', cookie).set(ORIGIN).send(body);
  const cancel = (id, body = { reason: 'Falscher Leistungszeitraum' }) => post(`/api/invoices/${id}/cancel`, body);

  // Positionsrabatt, Gesamtrabatt, 7 % + 19 %
  async function createInvoice({ status = 'sent', customer = customerId } = {}) {
    const res = await post('/api/invoices', {
      customerId: customer,
      issueDate: `${YEAR}-03-10`,
      dueDate: `${YEAR}-03-24`,
      globalDiscountType: 'percentage',
      globalDiscountValue: 5,
      globalDiscountAmount: 7.13,
      items: [
        { description: 'Montage', quantity: 3, unitPrice: 33.33, taxRate: 19, discountType: 'fixed', discountValue: 10, discountAmount: 10 },
        { description: 'Material', quantity: 2.5, unitPrice: 19.99, taxRate: 7, discountType: 'percentage', discountValue: 10, discountAmount: 5 },
        { description: 'Anfahrt', quantity: 1, unitPrice: 25, taxRate: 19 },
      ],
    });
    expect(res.status).toBe(201);
    if (status !== 'draft') expect((await put(res.body.id, { status })).status).toBe(200);
    return res.body;
  }

  const row = async (id) => (await pool.query('SELECT * FROM invoices WHERE id = $1', [id])).rows[0];
  const items = async (id) => (await pool.query(
    'SELECT description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount FROM invoice_items WHERE invoice_id = $1 ORDER BY item_order',
    [id]
  )).rows;
  const neg = (v) => (v === null ? null : (-Number(v)).toFixed(2));

  beforeAll(migrateTestDb);
  afterAll(() => pool.end());
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(async () => {
    await resetAuthTables();
    await pool.query('TRUNCATE job_entries, quotes, invoice_items, invoice_attachments, invoices, customers, yearly_invoice_start_numbers, usage_counters CASCADE');
    ({ cookie } = await loginAs('user'));
    ({ rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, address, city, postal_code, country, customer_number)
       VALUES ('Kunde GmbH', 'Str. 2', 'Berlin', '10115', 'Deutschland', 'K-1') RETURNING id`
    ));
  });

  it('erzeugt eine Stornorechnung mit negierten Positionen und exakt negierten Summen', async () => {
    const original = await createInvoice();
    const res = await cancel(original.id);
    expect(res.status).toBe(201);
    const { cancellation } = res.body;

    expect(cancellation.invoiceNumber).toBe(`ST-${YEAR}-001`);
    expect(cancellation.invoiceType).toBe('cancellation');
    expect(cancellation.cancelsInvoiceId).toBe(original.id);
    expect(cancellation.cancelsInvoice).toMatchObject({ id: original.id, invoiceNumber: original.invoiceNumber });
    expect(cancellation.cancellationReason).toBe('Falscher Leistungszeitraum');
    expect(cancellation.status).toBe('cancelled');
    expect(res.body.original.status).toBe('cancelled');
    expect(res.body.original.cancelledByInvoice).toEqual({ id: cancellation.id, invoiceNumber: `ST-${YEAR}-001` });

    const o = await row(original.id);
    const s = await row(cancellation.id);
    for (const col of ['subtotal', 'tax_amount', 'total', 'global_discount_amount']) {
      expect(s[col]).toBe(neg(o[col]));
    }
    expect(s.global_discount_type).toBe('percentage');
    expect(s.global_discount_value).toBe(o.global_discount_value);
    expect(s.customer_id).toBe(o.customer_id);
    expect(s.customer_name).toBe(o.customer_name);
    expect(s.issue_date.getTime()).toBe(s.due_date.getTime());
    expect(s.quota_counted_at).not.toBeNull();

    const oi = await items(original.id);
    const si = await items(cancellation.id);
    expect(si).toEqual(oi.map((it) => ({
      ...it,
      quantity: neg(it.quantity),
      total: neg(it.total),
      discount_amount: neg(it.discount_amount),
      discount_value: it.discount_type === 'fixed' ? neg(it.discount_value) : it.discount_value,
    })));

    const audits = await waitForAudit('invoice.cancelled');
    expect(audits[0].entity_id).toBe(original.id);
    expect(audits[0].details).toMatchObject({ cancellationId: cancellation.id, reason: 'Falscher Leistungszeitraum' });
  });

  it('eigener Nummernkreis ST: fortlaufend, ohne Einfluss auf RE und ohne Startnummer', async () => {
    await pool.query('INSERT INTO yearly_invoice_start_numbers (year, start_number) VALUES ($1, 500)', [YEAR]);
    const a = await createInvoice();
    const b = await createInvoice();
    expect([a.invoiceNumber, b.invoiceNumber]).toEqual([`RE-${YEAR}-500`, `RE-${YEAR}-501`]);

    expect((await cancel(a.id)).body.cancellation.invoiceNumber).toBe(`ST-${YEAR}-001`);
    const c = await createInvoice();
    expect(c.invoiceNumber).toBe(`RE-${YEAR}-502`);
    expect((await cancel(b.id)).body.cancellation.invoiceNumber).toBe(`ST-${YEAR}-002`);
    expect((await createInvoice()).invoiceNumber).toBe(`RE-${YEAR}-503`);
  });

  describe('Quellen', () => {
    async function linkSources(invoiceId) {
      const { rows: [{ id: quoteId }] } = await pool.query(
        `INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status, converted_to_invoice_id)
         VALUES ('AN-1', $1, 'Kunde GmbH', CURRENT_DATE, CURRENT_DATE + 30, 100, 19, 119, 'billed', $2) RETURNING id`,
        [customerId, invoiceId]
      );
      const { rows: [{ id: jobId }] } = await pool.query(
        `INSERT INTO job_entries (job_number, customer_id, title, date, description, status, invoice_id, quote_id)
         VALUES ('A-1', $1, 'Auftrag', CURRENT_DATE, 'Auftrag', 'invoiced', $2, $3) RETURNING id`,
        [customerId, invoiceId, quoteId]
      );
      return { quoteId, jobId };
    }
    const sources = async ({ quoteId, jobId }) => ({
      quote: (await pool.query('SELECT status, converted_to_invoice_id FROM quotes WHERE id = $1', [quoteId])).rows[0],
      job: (await pool.query('SELECT status, invoice_id FROM job_entries WHERE id = $1', [jobId])).rows[0],
    });

    it('gibt Aufträge und Angebot standardmäßig wieder frei', async () => {
      const original = await createInvoice();
      const ids = await linkSources(original.id);
      expect((await cancel(original.id)).status).toBe(201);
      expect(await sources(ids)).toEqual({
        quote: { status: 'accepted', converted_to_invoice_id: null },
        job: { status: 'completed', invoice_id: null },
      });
    });

    it('releaseSources: false lässt die Quellen am Original', async () => {
      const original = await createInvoice();
      const ids = await linkSources(original.id);
      expect((await cancel(original.id, { reason: 'x', releaseSources: false })).status).toBe(201);
      expect(await sources(ids)).toEqual({
        quote: { status: 'billed', converted_to_invoice_id: original.id },
        job: { status: 'invoiced', invoice_id: original.id },
      });
    });

    it('replacementInvoiceId hängt die Quellen auf den neuen Entwurf um', async () => {
      const original = await createInvoice();
      const ids = await linkSources(original.id);
      const replacement = await createInvoice({ status: 'draft' });
      const res = await cancel(original.id, { reason: 'x', replacementInvoiceId: replacement.id });
      expect(res.status).toBe(201);
      expect(await sources(ids)).toEqual({
        quote: { status: 'billed', converted_to_invoice_id: replacement.id },
        job: { status: 'invoiced', invoice_id: replacement.id },
      });
    });

    it('replacementInvoiceId muss ein Entwurf desselben Kunden sein', async () => {
      const original = await createInvoice();
      const released = await createInvoice();
      const { rows: [{ id: other }] } = await pool.query(
        `INSERT INTO customers (name, address, city, postal_code, country, customer_number)
         VALUES ('Andere', 'Str. 3', 'Berlin', '10115', 'Deutschland', 'K-2') RETURNING id`
      );
      const foreignDraft = await createInvoice({ status: 'draft', customer: other });
      for (const replacementInvoiceId of [released.id, foreignDraft.id, original.id, '00000000-0000-0000-0000-000000000000']) {
        expect((await cancel(original.id, { reason: 'x', replacementInvoiceId })).status).toBe(400);
      }
      expect((await row(original.id)).status).toBe('sent');
    });
  });

  it('zählt nicht gegen das Kontingent (Free-Limit ausgeschöpft)', async () => {
    const original = await createInvoice();
    vi.stubEnv('OPENBILLS_PLAN', 'free');
    await pool.query(
      `INSERT INTO usage_counters (period, kind, count) VALUES ($1, 'invoices', 9999)
       ON CONFLICT (period, kind) DO UPDATE SET count = 9999`,
      [currentPeriod()]
    );
    expect((await cancel(original.id)).status).toBe(201);
    const { rows: [{ count }] } = await pool.query("SELECT count FROM usage_counters WHERE period = $1 AND kind = 'invoices'", [currentPeriod()]);
    expect(count).toBe(9999);
  });

  it('lehnt Entwürfe, doppeltes Storno und Stornorechnungen ab (409), Grund ist Pflicht (400)', async () => {
    const draft = await createInvoice({ status: 'draft' });
    let res = await cancel(draft.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVOICE_NOT_CANCELLABLE');

    const original = await createInvoice();
    expect((await cancel(original.id, { reason: '' })).status).toBe(400);
    expect((await cancel(original.id, { reason: '   ' })).status).toBe(400);
    expect((await cancel(original.id, {})).status).toBe(400);
    expect((await cancel(original.id, { reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await row(original.id)).status).toBe('sent');

    res = await cancel(original.id);
    expect(res.status).toBe(201);
    expect((await cancel(original.id)).body.code).toBe('INVOICE_NOT_CANCELLABLE');
    expect((await cancel(res.body.cancellation.id)).body.code).toBe('INVOICE_NOT_CANCELLABLE');
    expect((await cancel('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('Reporting: Journal enthält Original und Storno mit Bezug, netto 0, nichts offen oder überfällig', async () => {
    const original = await createInvoice({ status: 'overdue' });
    const { body: { cancellation } } = await cancel(original.id);

    const journal = await request(app).get('/api/reporting/invoice-journal').set('Cookie', cookie);
    expect(journal.status).toBe(200);
    const byNumber = Object.fromEntries(journal.body.invoices.map((i) => [i.invoiceNumber, i]));
    expect(byNumber[original.invoiceNumber]).toMatchObject({ status: 'cancelled', invoiceType: 'invoice', cancelsInvoiceNumber: null });
    expect(byNumber[cancellation.invoiceNumber]).toMatchObject({
      status: 'cancelled', invoiceType: 'cancellation', cancelsInvoiceNumber: original.invoiceNumber,
    });
    const { summary } = journal.body;
    expect(summary.totalInvoices).toBe(2);
    for (const key of ['totalAmount', 'subtotalSum', 'taxSum', 'paidAmount', 'overdueAmount', 'outstandingAmount']) {
      expect(summary[key]).toBeCloseTo(0, 6);
    }

    const stats = await request(app).get(`/api/reporting/statistics?year=${YEAR}`).set('Cookie', cookie);
    expect(stats.status).toBe(200);
    expect(stats.body.statusDistribution).toEqual([{ status: 'cancelled', count: 2, totalAmount: 0 }]);
    expect(stats.body.yearOverview).toMatchObject({ overdueAmount: 0, paidAmount: 0 });
    expect(stats.body.yearOverview.totalAmount).toBeCloseTo(0, 6);

    const pdf = await post('/api/reporting/invoice-journal/pdf', {});
    expect(pdf.status).toBe(200);
  });

  it('paralleles Storno erzeugt genau eine Stornorechnung', async () => {
    const original = await createInvoice();
    const results = await Promise.all([cancel(original.id), cancel(original.id), cancel(original.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const { rows } = await pool.query('SELECT id FROM invoices WHERE cancels_invoice_id = $1', [original.id]);
    expect(rows).toHaveLength(1);
  });
});
