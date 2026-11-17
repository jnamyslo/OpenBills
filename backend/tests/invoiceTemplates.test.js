import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, waitForAudit, ORIGIN } from './helpers/auth.js';
import { createApp } from '../app.js';

const app = createApp();
const TEMPLATE = { id: 't1', name: 'Beratung', unitPrice: 120, unit: 'Stunde', taxRate: 19 };

describe.skipIf(!hasDb)('PUT /api/invoice-templates', () => {
  let cookie;
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
    await pool.query(`UPDATE company SET invoice_templates = '[]'::jsonb WHERE id = 1`);
    ({ cookie } = await loginAs('user'));
  });
  const put = (body, c = cookie) => request(app).put('/api/invoice-templates').set('Cookie', c).set(ORIGIN).send(body);

  it('user darf Vorlagen speichern, Änderung bleibt erhalten', async () => {
    const res = await put({ invoiceTemplates: [TEMPLATE] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([TEMPLATE]);
    const company = await request(app).get('/api/company').set('Cookie', cookie);
    expect(company.body.invoiceTemplates).toEqual([TEMPLATE]);
    const rows = await waitForAudit('PUT /api/invoice-templates');
    expect(rows).toHaveLength(1);
  });

  it('PUT /api/company bleibt für user 403', async () => {
    const res = await request(app).put('/api/company').set('Cookie', cookie).set(ORIGIN).send({ invoiceTemplates: [TEMPLATE] });
    expect(res.status).toBe(403);
  });

  it('PUT /api/company als admin liefert die Vorlagen mit aus', async () => {
    await put({ invoiceTemplates: [TEMPLATE] });
    const admin = await loginAs('admin');
    const res = await request(app).put('/api/company').set('Cookie', admin.cookie).set(ORIGIN).send({ name: 'Testfirma' });
    expect(res.status).toBe(200);
    expect(res.body.invoiceTemplates).toEqual([TEMPLATE]);
  });

  it.each([
    ['fehlendes Feld', {}],
    ['kein Array', { invoiceTemplates: { a: 1 } }],
    ['Element kein Objekt', { invoiceTemplates: ['x'] }],
    ['Element null', { invoiceTemplates: [null] }],
    ['Element Array', { invoiceTemplates: [[]] }],
    ['mehr als 200', { invoiceTemplates: Array.from({ length: 201 }, (_, i) => ({ id: String(i) })) }],
  ])('ungültiger Body (%s) -> 400', async (_label, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });
});
