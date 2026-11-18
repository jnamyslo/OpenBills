import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';

const app = createApp();

// 2,5 × 19,99 = 49,975 → 49,98; Gesamtrabatt 5 % je Satz verteilt; Steuer je Satz gerundet.
// Erwartung = src/utils/__tests__/centTotals.test.ts („Beispiel aus dem KoSIT-Lauf“).
const ITEMS = [
  { description: 'Montage', quantity: 3, unitPrice: 33.33, taxRate: 19, discountType: 'fixed', discountValue: 10 },
  { description: 'Material', quantity: 2.5, unitPrice: 19.99, taxRate: 7, discountType: 'percentage', discountValue: 10 },
  { description: 'Anfahrt', quantity: 1, unitPrice: 25, taxRate: 19 },
];
// Absichtlich falsche Client-Werte: das Backend rechnet selbst. (Ein Rabattbetrag ohne Rabatttyp
// gilt als Altdatum und wird als Festrabatt übernommen, daher nur bei Positionen mit Typ verfälscht.)
const BOGUS = { subtotal: 1, taxAmount: 1, total: 1, globalDiscountAmount: 99 };
const withBogusItems = () => ITEMS.map((i) => ({ ...i, total: 0.01, ...(i.discountType ? { discountAmount: 0.01 } : {}) }));
const EXPECTED = { subtotal: '174.97', tax_amount: '23.75', total: '175.72', global_discount_amount: '8.00' };
const EXPECTED_ITEMS = [
  { total: '89.99', discount_amount: '10.00' },
  { total: '44.98', discount_amount: '5.00' },
  { total: '25.00', discount_amount: null },
];

describe.skipIf(!hasDb)('Belegsummen im Backend (Cent-genau, Parität mit dem Frontend)', () => {
  let cookie;
  let customerId;
  const post = (url, body) => request(app).post(url).set('Cookie', cookie).set(ORIGIN).send(body);
  const put = (url, body) => request(app).put(url).set('Cookie', cookie).set(ORIGIN).send(body);
  const header = async (table, id) => (await pool.query(
    `SELECT subtotal, tax_amount, total, global_discount_amount FROM ${table} WHERE id = $1`, [id]
  )).rows[0];
  const lines = async (table, fk, id) => (await pool.query(
    `SELECT total, discount_amount FROM ${table} WHERE ${fk} = $1 ORDER BY item_order`, [id]
  )).rows;

  beforeAll(migrateTestDb);
  afterAll(async () => {
    await pool.query('UPDATE company SET is_small_business = false WHERE id = 1');
    await pool.end();
  });

  beforeEach(async () => {
    await resetAuthTables();
    await pool.query('TRUNCATE job_entries, quote_items, quotes, invoice_items, invoices, customers CASCADE');
    await pool.query(
      `INSERT INTO company (id, name, address, city, postal_code, country, phone, email, tax_id)
       VALUES (1, 'Testfirma', 'Str. 1', 'Berlin', '10115', 'Deutschland', '0', 'a@b.de', 'DE1')
       ON CONFLICT (id) DO NOTHING`
    );
    await pool.query('UPDATE company SET is_small_business = false WHERE id = 1');
    ({ cookie } = await loginAs('user'));
    ({ rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, address, city, postal_code, country, customer_number)
       VALUES ('Kunde GmbH', 'Str. 2', 'Berlin', '10115', 'Deutschland', 'K-1') RETURNING id`
    ));
  });

  const invoiceBody = (extra = {}) => ({
    customerId, issueDate: '2026-03-10', dueDate: '2026-03-24',
    globalDiscountType: 'percentage', globalDiscountValue: 5, ...BOGUS, items: withBogusItems(), ...extra,
  });

  it('Rechnung anlegen: Summen und Positionen aus Typ/Wert, Client-Beträge ignoriert', async () => {
    const res = await post('/api/invoices', invoiceBody());
    expect(res.status).toBe(201);
    expect(await header('invoices', res.body.id)).toEqual(EXPECTED);
    expect(await lines('invoice_items', 'invoice_id', res.body.id)).toEqual(EXPECTED_ITEMS);
  });

  it('Rechnungsentwurf mit Positionen ändern: neu berechnet', async () => {
    const { body: { id } } = await post('/api/invoices', invoiceBody({ items: [ITEMS[2]], globalDiscountType: null, globalDiscountValue: null }));
    expect((await put(`/api/invoices/${id}`, { ...BOGUS, items: withBogusItems(), globalDiscountType: 'percentage', globalDiscountValue: 5 })).status).toBe(200);
    expect(await header('invoices', id)).toEqual(EXPECTED);
    expect(await lines('invoice_items', 'invoice_id', id)).toEqual(EXPECTED_ITEMS);
  });

  it('Angebot anlegen und ändern: gleiche Summen', async () => {
    const quote = { customerId, issueDate: '2026-03-10', validUntil: '2026-04-10', globalDiscountType: 'percentage', globalDiscountValue: 5, ...BOGUS, items: withBogusItems() };
    const res = await post('/api/quotes', quote);
    expect(res.status).toBe(201);
    expect(await header('quotes', res.body.id)).toEqual(EXPECTED);
    expect(await lines('quote_items', 'quote_id', res.body.id)).toEqual(EXPECTED_ITEMS);

    expect((await put(`/api/quotes/${res.body.id}`, { ...BOGUS, items: withBogusItems() })).status).toBe(200);
    expect(await header('quotes', res.body.id)).toEqual(EXPECTED);
  });

  it('Kleinunternehmer: keine Steuer, unabhängig vom Positionssteuersatz', async () => {
    await pool.query('UPDATE company SET is_small_business = true WHERE id = 1');
    const res = await post('/api/invoices', invoiceBody());
    expect(await header('invoices', res.body.id)).toEqual({ subtotal: '174.97', tax_amount: '0.00', total: '151.97', global_discount_amount: '8.00' });
  });
});
