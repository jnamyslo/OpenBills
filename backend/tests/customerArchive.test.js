import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { pool } from '../database.js';
import { hasDb, migrateTestDb, resetAuthTables } from './helpers/db.js';
import { loginAs, ORIGIN, waitForAudit } from './helpers/auth.js';
import { createApp } from '../app.js';

const app = createApp();
const YEAR = new Date().getFullYear();

describe.skipIf(!hasDb)('Kunden archivieren', () => {
  let cookie;
  let customerId;
  let otherId;

  const send = (method, url, body) => request(app)[method](url).set('Cookie', cookie).set(ORIGIN).send(body);
  const archive = (id) => send('post', `/api/customers/${id}/archive`);
  const unarchive = (id) => send('post', `/api/customers/${id}/unarchive`);
  const items = [{ description: 'Montage', quantity: 1, unitPrice: 100, taxRate: 19 }];
  const newInvoice = (customer) => send('post', '/api/invoices', {
    customerId: customer, issueDate: `${YEAR}-03-10`, dueDate: `${YEAR}-03-24`, items,
  });
  const newQuote = (customer) => send('post', '/api/quotes', {
    customerId: customer, issueDate: `${YEAR}-03-10`, validUntil: `${YEAR}-04-10`, items,
  });
  const newJob = (customer) => send('post', '/api/jobs', {
    customerId: customer, title: 'Auftrag', description: 'Arbeit', date: `${YEAR}-03-10`,
  });

  async function insertCustomer(name, number) {
    const { rows } = await pool.query(
      `INSERT INTO customers (name, address, city, postal_code, country, customer_number)
       VALUES ($1, 'Str. 2', 'Berlin', '10115', 'Deutschland', $2) RETURNING id`,
      [name, number]
    );
    return rows[0].id;
  }

  async function releasedInvoice() {
    const res = await newInvoice(customerId);
    expect(res.status).toBe(201);
    expect((await send('put', `/api/invoices/${res.body.id}`, { status: 'sent' })).status).toBe(200);
    return res.body;
  }

  beforeAll(migrateTestDb);
  afterAll(() => pool.end());

  beforeEach(async () => {
    await resetAuthTables();
    await pool.query('TRUNCATE job_entries, quotes, invoice_items, invoice_attachments, invoices, customers, yearly_invoice_start_numbers, usage_counters CASCADE');
    ({ cookie } = await loginAs('user'));
    customerId = await insertCustomer('Kunde GmbH', 'K-1');
    otherId = await insertCustomer('Anderer Kunde', 'K-2');
  });

  it('archiviert und stellt wieder her, mit Audit und archivedAt in der Liste', async () => {
    const res = await archive(customerId);
    expect(res.status).toBe(200);
    expect(res.body.archivedAt).toBeTruthy();

    const list = await send('get', '/api/customers');
    expect(list.body.find((c) => c.id === customerId).archivedAt).toBeTruthy();
    expect(list.body.find((c) => c.id === otherId).archivedAt).toBeNull();
    expect((await send('get', `/api/customers/${customerId}`)).body.archivedAt).toBeTruthy();
    expect(await waitForAudit('customer.archived')).toMatchObject([{ entity_type: 'customer', entity_id: customerId }]);

    // erneut archivieren ändert den Zeitpunkt nicht
    const again = await archive(customerId);
    expect(again.status).toBe(200);
    expect(again.body.archivedAt).toBe(res.body.archivedAt);

    const restored = await unarchive(customerId);
    expect(restored.status).toBe(200);
    expect(restored.body.archivedAt).toBeNull();
    expect(await waitForAudit('customer.unarchived')).toHaveLength(1);

    expect((await archive('00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('lehnt neue Rechnungen, Angebote und Aufträge für archivierte Kunden ab', async () => {
    await archive(customerId);
    for (const res of [await newInvoice(customerId), await newQuote(customerId), await newJob(customerId)]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CUSTOMER_ARCHIVED');
    }
    expect((await newInvoice(otherId)).status).toBe(201);
  });

  it('wandelt Angebote archivierter Kunden nicht in Rechnung oder Auftrag um', async () => {
    const quote = (await newQuote(customerId)).body;
    expect((await send('put', `/api/quotes/${quote.id}`, { status: 'accepted' })).status).toBe(200);
    await archive(customerId);
    for (const target of ['convert-to-invoice', 'convert-to-job']) {
      const res = await send('post', `/api/quotes/${quote.id}/${target}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CUSTOMER_ARCHIVED');
    }
    await unarchive(customerId);
    expect((await send('post', `/api/quotes/${quote.id}/convert-to-job`)).status).toBe(201);
  });

  it('lehnt den Wechsel eines Entwurfs oder Auftrags auf einen archivierten Kunden ab', async () => {
    const draft = (await newInvoice(otherId)).body;
    const quote = (await newQuote(otherId)).body;
    const job = (await newJob(otherId)).body;
    await archive(customerId);

    for (const [url, body] of [
      [`/api/invoices/${draft.id}`, { customerId }],
      [`/api/quotes/${quote.id}`, { customerId }],
      [`/api/jobs/${job.id}`, { customerId, title: 'Auftrag', description: 'Arbeit' }],
    ]) {
      const res = await send('put', url, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CUSTOMER_ARCHIVED');
    }
  });

  it('bestehende Belege bleiben nutzbar: lesen, bearbeiten (ohne Kundenwechsel), Statuswechsel, Storno', async () => {
    const draft = (await newInvoice(customerId)).body;
    const job = (await newJob(customerId)).body;
    const invoice = await releasedInvoice();
    await archive(customerId);

    expect((await send('get', `/api/invoices/${invoice.id}`)).status).toBe(200);
    expect((await send('put', `/api/invoices/${draft.id}`, { customerId, notes: 'geändert' })).status).toBe(200);
    expect((await send('put', `/api/jobs/${job.id}`, { customerId, title: 'Neu', description: 'Arbeit' })).status).toBe(200);
    expect((await send('put', `/api/invoices/${invoice.id}`, { status: 'paid' })).status).toBe(200);
    const cancelled = await send('post', `/api/invoices/${invoice.id}/cancel`, { reason: 'Doppelt' });
    expect(cancelled.status).toBe(201);
  });

  it('Stammdaten archivierter Kunden sind gesperrt, Löschen bleibt 409', async () => {
    await releasedInvoice();
    await archive(customerId);
    const edit = await send('put', `/api/customers/${customerId}`, {
      name: 'Neu', address: 'Str. 2', city: 'Berlin', postalCode: '10115', country: 'Deutschland',
    });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('CUSTOMER_ARCHIVED');
    expect((await pool.query('SELECT name FROM customers WHERE id = $1', [customerId])).rows[0].name).toBe('Kunde GmbH');

    const del = await send('delete', `/api/customers/${customerId}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('CUSTOMER_HAS_INVOICES');
  });

  it('Restore eines alten Backups ohne archived_at funktioniert', async () => {
    const { cookie: adminCookie } = await loginAs('admin');
    const created = await request(app).post('/api/backup/create-zip').set('Cookie', adminCookie).set(ORIGIN)
      .send({ passphrase: 'backup-passwort-123' });
    expect(created.status).toBe(200);
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const { default: AdmZip } = await import('adm-zip');
    const { decryptBackup } = await import('../utils/backupCrypto.js');
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../backups', created.body.filename);
    try {
      const zip = new AdmZip(file);
      const header = JSON.parse(zip.getEntry('encryption.json').getData().toString('utf8'));
      const backup = JSON.parse(decryptBackup(header, zip.getEntry('database.json.enc').getData(), 'backup-passwort-123').toString('utf8'));
      backup.data.customers = backup.data.customers.map(({ archived_at: _drop, ...rest }) => rest);
      const legacy = new AdmZip();
      legacy.addFile('database.json', Buffer.from(JSON.stringify(backup)));

      const res = await request(app).post('/api/backup/restore-zip').set('Cookie', adminCookie).set(ORIGIN)
        .attach('backupFile', legacy.toBuffer(), 'backup.zip');
      expect(res.status).toBe(200);
      const { rows } = await pool.query('SELECT name, archived_at FROM customers ORDER BY name');
      expect(rows).toEqual([{ name: 'Anderer Kunde', archived_at: null }, { name: 'Kunde GmbH', archived_at: null }]);
    } finally {
      await fs.rm(file, { force: true });
    }
  });
});
