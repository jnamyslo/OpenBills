import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN, waitForAudit } from './helpers/auth.js';

const mail = vi.hoisted(() => ({
  sendQuoteEmail: vi.fn(async () => ({ success: true })),
  sendQuoteResponseNotification: vi.fn(async () => {}),
}));
vi.mock('../services/emailService.js', async (importOriginal) => ({ ...(await importOriginal()), sendQuoteEmail: mail.sendQuoteEmail }));
vi.mock('../services/authMailService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendQuoteResponseNotification: mail.sendQuoteResponseNotification,
}));

const { createApp } = await import('../app.js');
const app = createApp();

describe.skipIf(!hasDb)('Angebot per Mail-Link annehmen/ablehnen', () => {
  let cookie;
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
    vi.clearAllMocks();
    await resetAuthTables();
    await pool.query('UPDATE company SET terms_url = NULL WHERE id = 1');
    await pool.query('TRUNCATE quote_responses, job_entries, quote_items, quotes, invoice_items, invoices, customers CASCADE');
    ({ cookie } = await loginAs('admin'));
    const { rows: [{ id: customerId }] } = await pool.query(
      `INSERT INTO customers (name, email, address, city, postal_code, country, customer_number)
       VALUES ('Kunde GmbH', 'k@test.example', 'Str. 2', 'Berlin', '10115', 'Deutschland', 'K-1') RETURNING id`
    );
    ({ rows: [{ id: quoteId }] } = await pool.query(
      `INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status)
       VALUES ('AN-2026-001', $1, 'Kunde GmbH', CURRENT_DATE, CURRENT_DATE + 30, 100, 19, 119, 'sent') RETURNING id`,
      [customerId]
    ));
    await pool.query(
      `INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order)
       VALUES ($1, 'Montage', 2, 50, 19, 100, 1)`,
      [quoteId]
    );
  });

  async function sendQuote() {
    const res = await request(app).post(`/api/quotes/${quoteId}/send-email`).set('Cookie', cookie).set(ORIGIN)
      .send({ customerEmails: ['k@test.example'] });
    expect(res.status).toBe(200);
    const link = mail.sendQuoteEmail.mock.calls.at(-1)[5];
    return link ? link.split('#angebot/')[1] : null;
  }

  const view = (token) => request(app).get(`/api/quote-response/${token}`);
  const respond = (token, body) => request(app).post(`/api/quote-response/${token}`).set(ORIGIN).send(body);
  const quoteStatus = async () => (await pool.query('SELECT status FROM quotes WHERE id = $1', [quoteId])).rows[0].status;

  it('Link in der Mail zeigt das Angebot und ändert beim Aufruf nichts', async () => {
    const token = await sendQuote();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const res = await view(token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('valid');
    expect(res.body.company.name).toBe('Testfirma');
    expect(res.body.quote).toMatchObject({ quoteNumber: 'AN-2026-001', total: 119 });
    expect(res.body.quote.items).toEqual([{ description: 'Montage', quantity: 2, unitPrice: 50, total: 100 }]);
    expect(await quoteStatus()).toBe('sent');
  });

  it('nimmt an: Status, Audit, Benachrichtigung, Antwort am Angebot; Link danach verbraucht', async () => {
    const token = await sendQuote();
    expect((await respond(token, { decision: 'accepted', name: ' ' })).status).toBe(400);

    const res = await respond(token, { decision: 'accepted', name: 'Erika Muster', comment: 'Passt so' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'answered', decision: 'accepted' });
    expect(await quoteStatus()).toBe('accepted');
    expect((await waitForAudit('quote.customer_accepted'))[0]).toMatchObject({ actor_label: 'Kunde: Erika Muster', entity_id: quoteId });
    await vi.waitFor(() => expect(mail.sendQuoteResponseNotification).toHaveBeenCalledWith('a@b.de', expect.objectContaining({
      quoteNumber: 'AN-2026-001', decision: 'accepted', responderName: 'Erika Muster', comment: 'Passt so',
    })));

    const quote = await request(app).get(`/api/quotes/${quoteId}`).set('Cookie', cookie);
    expect(quote.body.customerResponse).toMatchObject({
      decision: 'accepted', name: 'Erika Muster', comment: 'Passt so', termsUrl: null, recipients: 'k@test.example',
    });

    const again = await respond(token, { decision: 'rejected', name: 'Erika Muster' });
    expect(again.status).toBe(409);
    expect(again.body.status).toBe('answered');
    expect((await view(token)).body).toMatchObject({ status: 'answered', decision: 'accepted' });
  });

  it('lehnt ab', async () => {
    const token = await sendQuote();
    expect((await respond(token, { decision: 'rejected', name: 'Erika Muster' })).status).toBe(200);
    expect(await quoteStatus()).toBe('rejected');
  });

  it('verlangt die AGB-Bestätigung nur bei Annahme und hinterlegtem AGB-Link', async () => {
    await pool.query(`UPDATE company SET terms_url = 'https://firma.example/agb' WHERE id = 1`);
    const token = await sendQuote();
    expect((await view(token)).body.company.termsUrl).toBe('https://firma.example/agb');
    const missing = await respond(token, { decision: 'accepted', name: 'Erika' });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('TERMS_REQUIRED');
    expect((await respond(token, { decision: 'accepted', name: 'Erika', acceptTerms: true })).status).toBe(200);
    const { rows } = await pool.query('SELECT terms_url, ip FROM quote_responses');
    expect(rows[0].terms_url).toBe('https://firma.example/agb');
  });

  it('Entwürfe bekommen keinen Link', async () => {
    await pool.query(`UPDATE quotes SET status = 'draft' WHERE id = $1`, [quoteId]);
    expect(await sendQuote()).toBeNull();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM quote_responses')).rows[0].n).toBe(0);
  });

  it('nach Änderung, Ablauf oder interner Statusänderung nicht mehr nutzbar', async () => {
    const token = await sendQuote();
    await pool.query(`UPDATE quote_items SET quantity = 3, total = 150 WHERE quote_id = $1`, [quoteId]);
    expect((await view(token)).body.status).toBe('changed');
    await pool.query(`UPDATE quote_items SET quantity = 2, total = 100 WHERE quote_id = $1`, [quoteId]);
    expect((await view(token)).body.status).toBe('valid');

    await pool.query(`UPDATE quote_responses SET expires_at = now() - interval '1 minute'`);
    expect((await view(token)).body.status).toBe('expired');
    const res = await respond(token, { decision: 'accepted', name: 'Erika' });
    expect(res.status).toBe(409);
    expect(await quoteStatus()).toBe('sent');

    await pool.query(`UPDATE quote_responses SET expires_at = now() + interval '1 day'`);
    await pool.query(`UPDATE quotes SET status = 'accepted' WHERE id = $1`, [quoteId]);
    expect((await view(token)).body.status).toBe('closed');
  });

  it('unbekanntes Token verrät nichts; POST ohne Origin wird abgewiesen', async () => {
    const res = await view('gibtesnicht');
    expect(res.body).toEqual({ status: 'invalid' });
    const token = await sendQuote();
    expect((await request(app).post(`/api/quote-response/${token}`).send({ decision: 'accepted', name: 'X' })).status).toBe(403);
  });

  it('AGB-Link in den Firmendaten nur mit http(s)', async () => {
    const bad = await request(app).put('/api/company').set('Cookie', cookie).set(ORIGIN).send({ termsUrl: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    const ok = await request(app).put('/api/company').set('Cookie', cookie).set(ORIGIN).send({ termsUrl: 'https://firma.example/agb' });
    expect(ok.status).toBe(200);
    expect(ok.body.termsUrl).toBe('https://firma.example/agb');
  });
});
