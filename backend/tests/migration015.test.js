import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { hasDb, migrateTestDb } from './helpers/db.js';

describe.skipIf(!hasDb)('Migration 015_document_archive', () => {
  let pool;
  let migration015;
  let customerId;

  async function insertInvoice(client, { id = randomUUID(), status = 'sent', cancelsInvoiceId = null, invoiceType = 'invoice' } = {}) {
    await client.query(
      `INSERT INTO invoices (id, invoice_number, customer_id, customer_name, issue_date, due_date,
         subtotal, tax_amount, total, status, invoice_type, cancels_invoice_id)
       VALUES ($1, $2, $3, 'Test', '2026-11-18', '2026-12-02', 100, 19, 119, $4, $5, $6)`,
      [id, `T15-${id.slice(0, 8)}`, customerId, status, invoiceType, cancelsInvoiceId]
    );
    return id;
  }

  async function insertArchive(sha = 'a'.repeat(64)) {
    const { rows } = await pool.query(
      `INSERT INTO document_archive (document_type, document_id, document_number, format, filename,
         content_type, size, content, sha256, source)
       VALUES ('invoice', $1, 'RE-2026-001', 'pdf', 'RE-2026-001.pdf', 'application/pdf', 3, 'YWJj', $2, 'output')
       RETURNING id, document_id`,
      [randomUUID(), sha]
    );
    return rows[0];
  }

  beforeAll(async () => {
    ({ pool } = await import('../database.js'));
    migration015 = await import('../migrations/015_document_archive.js');
    await migrateTestDb();
    const { rows } = await pool.query(
      `INSERT INTO customers (customer_number, name, address, city, postal_code, country)
       VALUES ($1, 'Test', 'Str. 1', 'Ort', '12345', 'DE') RETURNING id`,
      [`T15-${randomUUID().slice(0, 8)}`]
    );
    customerId = rows[0].id;
  });

  afterEach(async () => {
    await pool.query('UPDATE invoices SET cancels_invoice_id = NULL WHERE customer_id = $1', [customerId]);
    await pool.query('DELETE FROM invoices WHERE customer_id = $1', [customerId]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
    const client = await pool.connect();
    try {
      await client.query('ALTER TABLE document_archive DISABLE TRIGGER document_archive_append_only');
      await client.query("DELETE FROM document_archive WHERE document_number = 'RE-2026-001'");
      await client.query('ALTER TABLE document_archive ENABLE TRIGGER document_archive_append_only');
    } finally {
      client.release();
    }
    await pool.end();
  });

  it('ist idempotent', async () => {
    const client = await pool.connect();
    try {
      await migration015.up(client);
      await migration015.up(client);
    } finally {
      client.release();
    }
  });

  it('erlaubt Status cancelled und neue Storno-Spalten', async () => {
    const id = await insertInvoice(pool, { status: 'cancelled' });
    const { rows } = await pool.query('SELECT status, invoice_type, cancels_invoice_id, cancellation_reason FROM invoices WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ status: 'cancelled', invoice_type: 'invoice', cancels_invoice_id: null, cancellation_reason: null });
  });

  it('lehnt unbekannten Status und Belegtyp ab', async () => {
    await expect(insertInvoice(pool, { status: 'foo' })).rejects.toMatchObject({ code: '23514' });
    await expect(insertInvoice(pool, { invoiceType: 'foo' })).rejects.toMatchObject({ code: '23514' });
  });

  it('erlaubt je Original höchstens eine Stornorechnung', async () => {
    const original = await insertInvoice(pool, { status: 'cancelled' });
    await insertInvoice(pool, { status: 'cancelled', invoiceType: 'cancellation', cancelsInvoiceId: original });
    await expect(
      insertInvoice(pool, { status: 'cancelled', invoiceType: 'cancellation', cancelsInvoiceId: original })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('prüft den Storno-Bezug erst beim Commit (Restore-Reihenfolge beliebig)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const originalId = randomUUID();
      await insertInvoice(client, { status: 'cancelled', invoiceType: 'cancellation', cancelsInvoiceId: originalId });
      await insertInvoice(client, { id: originalId, status: 'cancelled' });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  it('verweigert UPDATE und DELETE auf document_archive', async () => {
    const { id } = await insertArchive('b'.repeat(64));
    await expect(pool.query("UPDATE document_archive SET filename = 'x' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM document_archive WHERE id = $1', [id])).rejects.toThrow(/append-only/);
  });

  it('verweigert doppelte Fassung mit gleichem Hash', async () => {
    const { document_id } = await insertArchive('c'.repeat(64));
    await expect(
      pool.query(
        `INSERT INTO document_archive (document_type, document_id, document_number, format, filename,
           content_type, size, content, sha256, source)
         VALUES ('invoice', $1, 'RE-2026-001', 'pdf', 'x.pdf', 'application/pdf', 3, 'YWJj', $2, 'output')`,
        [document_id, 'c'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });
});
