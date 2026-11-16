import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';

const app = createApp();

describe.skipIf(!hasDb)('Belegkette Angebot → Auftrag → Rechnung', () => {
  let cookie;
  let customerId;
  let quoteId;

  beforeAll(async () => {
    await migrateTestDb();
    await pool.query(
      `INSERT INTO company (id, name, address, city, postal_code, country, phone, email, tax_id)
       VALUES (1, 'Testfirma', 'Str. 1', 'Berlin', '10115', 'Deutschland', '0', 'a@b.de', 'DE1')
       ON CONFLICT (id) DO NOTHING`
    );
  });
  afterAll(() => pool.end());

  beforeEach(async () => {
    await resetAuthTables();
    await pool.query('TRUNCATE job_entries, quote_items, quotes, invoice_items, invoices, customers CASCADE');
    ({ cookie } = await loginAs('admin'));
    ({ rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, email, address, city, postal_code, country, customer_number)
       VALUES ('Kunde', 'k@test.example', 'Str. 2', 'Berlin', '10115', 'Deutschland', 'K-1') RETURNING id`
    ));
    ({ rows: [{ id: quoteId }] } = await pool.query(
      `INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status)
       VALUES ('AN-2026-001', $1, 'Kunde', CURRENT_DATE, CURRENT_DATE + 30, 100, 19, 119, 'accepted') RETURNING id`,
      [customerId]
    ));
    await pool.query(
      `INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order)
       VALUES ($1, 'Montage', 2, 50, 19, 100, 1)`,
      [quoteId]
    );
  });

  const post = (path) => request(app).post(path).set('Cookie', cookie).set(ORIGIN).send({});

  it('erzeugt aus dem Angebot einen Auftrag mit übernommenen Positionen', async () => {
    const res = await post(`/api/quotes/${quoteId}/convert-to-job`);
    expect(res.status).toBe(201);
    expect(res.body.quoteId).toBe(quoteId);
    expect(res.body.status).toBe('draft');
    expect(res.body.jobNumber).toMatch(/^AB-\d{4}-001$/);
    expect(res.body.materials).toHaveLength(1);
    expect(res.body.materials[0]).toMatchObject({ description: 'Montage', quantity: 2, unitPrice: 50, taxRate: 19, total: 100 });
  });

  it('lehnt eine zweite Umwandlung ab', async () => {
    await post(`/api/quotes/${quoteId}/convert-to-job`);
    const res = await post(`/api/quotes/${quoteId}/convert-to-job`);
    expect(res.status).toBe(400);
  });

  it('lehnt nicht angenommene Angebote ab', async () => {
    await pool.query(`UPDATE quotes SET status = 'sent' WHERE id = $1`, [quoteId]);
    const res = await post(`/api/quotes/${quoteId}/convert-to-job`);
    expect(res.status).toBe(400);
  });

  it('übernimmt Gesamtrabatt und Positionen mit gemischten Steuersätzen und Positionsrabatten unverändert', async () => {
    await pool.query('DELETE FROM quote_items WHERE quote_id = $1', [quoteId]);
    await pool.query(
      `INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
       VALUES ($1, 'Montage', 3, 49.90, 19, 130.99, 1, 'percentage', 12.5, 18.71),
              ($1, 'Buch', 2, 14.95, 7, 29.90, 2, NULL, NULL, NULL),
              ($1, 'Auslage', 1, 12.34, 0, 9.84, 3, 'fixed', 2.5, 2.5)`,
      [quoteId]
    );
    await pool.query(
      `UPDATE quotes SET global_discount_type = 'percentage', global_discount_value = 7.5, global_discount_amount = 12.3 WHERE id = $1`,
      [quoteId]
    );
    const res = await post(`/api/quotes/${quoteId}/convert-to-job`);
    expect(res.status).toBe(201);
    expect(res.body.globalDiscountType).toBe('percentage');
    expect(res.body.globalDiscountValue).toBe(7.5);
    expect(res.body.materials.map((m) => [m.description, m.quantity, m.unitPrice, m.taxRate, m.discountType, m.discountValue])).toEqual([
      ['Montage', 3, 49.9, 19, 'percentage', 12.5],
      ['Buch', 2, 14.95, 7, undefined, undefined],
      ['Auslage', 1, 12.34, 0, 'fixed', 2.5],
    ]);
  });

  it('übernimmt Arbeitszeit-Positionen als Zeiteintrag (Menge x Stundensatz) und Material weiterhin als Material', async () => {
    await pool.query('DELETE FROM quote_items WHERE quote_id = $1', [quoteId]);
    const rateId = '11111111-1111-4111-8111-111111111111';
    await pool.query(
      `INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount, kind, hourly_rate_id)
       VALUES ($1, 'Standard', 2.5, 75, 19, 168.75, 1, 'percentage', 10, 18.75, 'labor', $2),
              ($1, 'Kabel', 4, 3, 19, 12, 2, NULL, NULL, NULL, 'material', NULL)`,
      [quoteId, rateId]
    );
    const res = await post(`/api/quotes/${quoteId}/convert-to-job`);
    expect(res.status).toBe(201);
    expect(res.body.materials.map((m) => m.description)).toEqual(['Kabel']);
    expect(res.body.timeEntries).toHaveLength(1);
    expect(res.body.timeEntries[0]).toMatchObject({
      description: 'Standard', hoursWorked: 2.5, hourlyRate: 75, hourlyRateId: rateId,
      total: 168.75, discountType: 'percentage', discountValue: 10, discountAmount: 18.75,
    });
  });

  it('Auftrag ohne Gesamtrabatt liefert keinen Rabatt', async () => {
    const res = await post(`/api/quotes/${quoteId}/convert-to-job`);
    expect(res.body.globalDiscountType).toBeUndefined();
    expect(res.body.globalDiscountValue).toBeUndefined();
  });

  it('Gesamtrabatt am Auftrag lässt sich anlegen, ändern und entfernen', async () => {
    const base = { customerId, title: 'T', description: 'D', date: '2026-11-16' };
    const created = await request(app).post('/api/jobs').set('Cookie', cookie).set(ORIGIN)
      .send({ ...base, globalDiscountType: 'fixed', globalDiscountValue: 15 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ globalDiscountType: 'fixed', globalDiscountValue: 15 });

    const put = (body) => request(app).put(`/api/jobs/${created.body.id}`).set('Cookie', cookie).set(ORIGIN).send(body);
    // Änderung anderer Felder lässt den Rabatt unberührt
    expect((await put({ title: 'T2' })).body).toMatchObject({ globalDiscountType: 'fixed', globalDiscountValue: 15 });
    expect((await put({ globalDiscountType: 'percentage', globalDiscountValue: 10 })).body)
      .toMatchObject({ globalDiscountType: 'percentage', globalDiscountValue: 10 });
    const cleared = await put({ globalDiscountType: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.globalDiscountType).toBeUndefined();
  });

  it('lehnt ungültige Gesamtrabatte am Auftrag ab', async () => {
    const base = { customerId, title: 'T', description: 'D', date: '2026-11-16' };
    const res = await request(app).post('/api/jobs').set('Cookie', cookie).set(ORIGIN)
      .send({ ...base, globalDiscountType: 'percentage', globalDiscountValue: 150 });
    expect(res.status).toBe(400);
  });

  it('verhindert direktes Abrechnen, sobald ein Auftrag existiert', async () => {
    await post(`/api/quotes/${quoteId}/convert-to-job`);
    const res = await post(`/api/quotes/${quoteId}/convert-to-invoice`);
    expect(res.status).toBe(400);
  });

  describe('direkte Abrechnung rechnet mit den Einstellungen von heute', () => {
    const setSmallBusiness = (flag) => pool.query('UPDATE company SET is_small_business = $1 WHERE id = 1', [flag]);
    afterAll(() => setSmallBusiness(false));

    // 19 % + 7 % Position, Gesamtrabatt 10 %; Angebotssummen sind für Regelbesteuerung gespeichert.
    async function seedMixedQuote() {
      await pool.query('DELETE FROM quote_items WHERE quote_id = $1', [quoteId]);
      await pool.query(
        `INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order)
         VALUES ($1, 'A', 2, 50, 19, 100, 1), ($1, 'B', 1, 100, 7, 100, 2)`,
        [quoteId]
      );
      await pool.query(
        `UPDATE quotes SET subtotal = 200, tax_amount = 23.4, total = 203.4,
           global_discount_type = 'percentage', global_discount_value = 10, global_discount_amount = 20 WHERE id = $1`,
        [quoteId]
      );
    }
    const convert = async () => {
      const res = await post(`/api/quotes/${quoteId}/convert-to-invoice`);
      expect(res.status).toBe(201);
      return res.body;
    };

    it('Regelbesteuerung: Summen entsprechen dem Angebot', async () => {
      await setSmallBusiness(false);
      await seedMixedQuote();
      const invoice = await convert();
      expect(invoice).toMatchObject({ subtotal: 200, taxAmount: 23.4, total: 203.4, globalDiscountAmount: 20 });
      expect(invoice.items.map((i) => i.taxRate)).toEqual([19, 7]);
    });

    it('Kleinunternehmer seit dem Angebot: keine Steuer, Positionen mit 0 %', async () => {
      await setSmallBusiness(true);
      await seedMixedQuote();
      const invoice = await convert();
      expect(invoice).toMatchObject({ subtotal: 200, taxAmount: 0, total: 180, globalDiscountAmount: 20 });
      expect(invoice.items.map((i) => i.taxRate)).toEqual([0, 0]);
    });

    it('Angebot unter Kleinunternehmerregelung, Rechnung mit Steuer: Steuer wird berechnet', async () => {
      await setSmallBusiness(false);
      await seedMixedQuote();
      await pool.query('UPDATE quotes SET tax_amount = 0, total = 180 WHERE id = $1', [quoteId]);
      const invoice = await convert();
      expect(invoice).toMatchObject({ taxAmount: 23.4, total: 203.4 });
    });
  });

  it('Abrechnung des Auftrags schließt das Angebot ab', async () => {
    const job = (await post(`/api/quotes/${quoteId}/convert-to-job`)).body;
    const { rows: [{ id: invoiceId }] } = await pool.query(
      `INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status)
       VALUES ('RE-2026-001', $1, 'Kunde', CURRENT_DATE, CURRENT_DATE + 14, 100, 19, 119, 'draft') RETURNING id`,
      [customerId]
    );
    const res = await request(app).put(`/api/jobs/${job.id}`).set('Cookie', cookie).set(ORIGIN)
      .send({ status: 'invoiced', invoiceId });
    expect(res.status).toBe(200);
    expect(res.body.invoiceId).toBe(invoiceId);
    const { rows: [quote] } = await pool.query('SELECT status, converted_to_invoice_id FROM quotes WHERE id = $1', [quoteId]);
    expect(quote).toEqual({ status: 'billed', converted_to_invoice_id: invoiceId });
  });
});
