import { pool } from '../database.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import logger from '../utils/logger.js';
import { validateDiscountFields } from '../utils/validation.js';
import { countReleaseIfNeeded } from './quotaService.js';
import { assertUpdateAllowed, assertDeleteAllowed } from '../utils/invoiceLock.js';
import { computeDocumentTotals } from './documentTotalsService.js';
import { loadActiveCustomer, assertCustomerChangeAllowed } from '../utils/customerArchive.js';

/**
 * Nächste Nummer im Kreis `<prefix>-YYYY-NNN` (Jahr aus dem Rechnungsdatum).
 * RE nutzt die Startnummern aus yearly_invoice_start_numbers, ST (Storno) beginnt immer bei 1.
 */
export async function generateInvoiceNumber(issueDate, prefix = 'RE') {
  const client = await pool.connect();
  try {
    // Use the year from the issue date instead of current system year
    const invoiceYear = new Date(issueDate).getFullYear();
    const yearPrefix = `${prefix}-${invoiceYear}-`;
    const lastInvoiceResult = await client.query('SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [`${yearPrefix}%`]);

    // Get year-specific invoice start number, fallback to 1 if not defined
    let yearStartNumber = 1;
    if (prefix === 'RE') {
      const yearlyStartResult = await client.query('SELECT start_number FROM yearly_invoice_start_numbers WHERE year = $1', [invoiceYear]);
      if (yearlyStartResult.rows.length > 0) yearStartNumber = yearlyStartResult.rows[0].start_number;
    }

    let nextNumber = yearStartNumber;
    const lastInvoiceNumber = lastInvoiceResult.rows[0]?.invoice_number;
    if (lastInvoiceNumber && lastInvoiceNumber.startsWith(yearPrefix)) {
      const lastNumber = parseInt(lastInvoiceNumber.substring(yearPrefix.length));
      // Continue from last number, but respect year start number as minimum
      if (!isNaN(lastNumber)) nextNumber = Math.max(lastNumber + 1, yearStartNumber);
    }

    return `${yearPrefix}${String(nextNumber).padStart(3, '0')}`;
  } finally {
    client.release();
  }
}

// 'cancelled' setzt ausschließlich der Storno-Service.
const CREATABLE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'];

export async function createInvoice(data) {
  if (data.status !== undefined && !CREATABLE_STATUSES.includes(data.status)) {
    const err = new Error('Ungültiger Status für eine neue Rechnung.');
    err.statusCode = 400;
    throw err;
  }
  const discountValidation = validateDiscountFields(data);
  if (!discountValidation.valid) {
    const err = new Error(discountValidation.message);
    err.statusCode = 400;
    throw err;
  }

  const {
    customerId,
    items = [],
    notes = '',
    attachments = [],
    issueDate = new Date().toISOString().split('T')[0],
    dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status = 'draft',
    globalDiscountType = null,
    globalDiscountValue = null,
  } = data;

  const maxAttempts = 5;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate invoice number before opening transaction (generateInvoiceNumber uses its own connection).
    // Regenerated on each attempt in case a concurrent request just took this number.
    const invoiceNumber = await generateInvoiceNumber(issueDate);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

    // Get customer name (archivierte Kunden: keine neuen Rechnungen)
    const customer = await loadActiveCustomer(client, customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }
    const customerName = customer.name;

    // Summen Cent-genau (Positionen, Gesamtrabatt je Steuersatz, Steuer je Satz gerundet)
    const totals = await computeDocumentTotals(client, items, globalDiscountType, globalDiscountValue);
    const { subtotal, taxAmount, total } = totals;

    // Insert invoice
    const invoiceResult = await client.query(`
      INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [invoiceNumber, customerId, customerName, issueDate, dueDate, subtotal, taxAmount, total, status, notes, globalDiscountType, globalDiscountValue, totals.globalDiscountAmount]);

    const invoiceId = invoiceResult.rows[0].id;

    // Insert invoice items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemOrder = item.order !== undefined ? item.order : (i + 1);
      const line = totals.lines[i];
      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [invoiceId, item.description, item.quantity, item.unitPrice, item.taxRate, line.net, itemOrder, item.discountType || null, item.discountValue || null, line.discount || null]);
    }

    // Insert attachments if provided
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [invoiceId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

      await countReleaseIfNeeded(client, 'invoices', invoiceId, status);

      await client.query('COMMIT');

      return await findInvoiceById(invoiceId);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505' && attempt < maxAttempts - 1) {
        lastError = error;
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  throw lastError;
}

export async function updateInvoice(id, data) {
  const discountValidation = validateDiscountFields(data);
  if (!discountValidation.valid) {
    const err = new Error(discountValidation.message);
    err.statusCode = 400;
    throw err;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateData = data;

    // First, get the current invoice to preserve existing values
    const currentInvoice = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);

    if (currentInvoice.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const current = currentInvoice.rows[0];

    // Freigegebene Rechnungen: nur Statuswechsel (siehe utils/invoiceLock.js)
    if (current.status !== 'draft' || updateData.status === 'cancelled') {
      const [items, attachments, archive] = await Promise.all([
        client.query('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY item_order', [id]),
        client.query('SELECT id FROM invoice_attachments WHERE invoice_id = $1', [id]),
        client.query(
          "SELECT 1 FROM document_archive WHERE document_type IN ('invoice', 'reminder') AND document_id = $1 LIMIT 1",
          [id]
        ),
      ]);
      assertUpdateAllowed(current, items.rows, attachments.rows, updateData, archive.rows.length > 0);

      const status = updateData.status ?? current.status;
      await client.query('UPDATE invoices SET status = $1 WHERE id = $2', [status, id]);
      await countReleaseIfNeeded(client, 'invoices', id, status);
      await client.query('COMMIT');
      return await findInvoiceById(id);
    }

    await assertCustomerChangeAllowed(client, current.customer_id, updateData.customerId);

    // Summen nur neu berechnen, wenn Positionen mitkommen (sonst wie bisher übernehmen)
    const globalDiscountType = updateData.globalDiscountType ?? current.global_discount_type;
    const globalDiscountValue = updateData.globalDiscountValue ?? current.global_discount_value;
    const totals = Array.isArray(updateData.items)
      ? await computeDocumentTotals(client, updateData.items, globalDiscountType, globalDiscountValue)
      : null;
    const calculatedSubtotal = totals ? totals.subtotal : (updateData.subtotal ?? current.subtotal);
    const calculatedTaxAmount = totals ? totals.taxAmount : (updateData.taxAmount ?? current.tax_amount);
    const calculatedTotal = totals ? totals.total : (updateData.total ?? current.total);

    // Merge current values with updates (but preserve invoice number)
    const mergedData = {
      invoiceNumber: current.invoice_number, // Always preserve existing invoice number
      customerId: updateData.customerId ?? current.customer_id,
      customerName: updateData.customerName ?? current.customer_name,
      issueDate: updateData.issueDate ?? current.issue_date,
      dueDate: updateData.dueDate ?? current.due_date,
      subtotal: calculatedSubtotal,
      taxAmount: calculatedTaxAmount,
      total: calculatedTotal,
      status: updateData.status ?? current.status,
      notes: updateData.notes ?? current.notes,
      globalDiscountType,
      globalDiscountValue,
      globalDiscountAmount: totals ? totals.globalDiscountAmount : (updateData.globalDiscountAmount ?? current.global_discount_amount),
      items: updateData.items // items are handled separately
    };

    // Update invoice
    await client.query(`
      UPDATE invoices
      SET invoice_number = $1, customer_id = $2, customer_name = $3, issue_date = $4,
          due_date = $5, subtotal = $6, tax_amount = $7, total = $8, status = $9, notes = $10,
          global_discount_type = $11, global_discount_value = $12, global_discount_amount = $13
      WHERE id = $14
      RETURNING *
    `, [
      mergedData.invoiceNumber,
      mergedData.customerId,
      mergedData.customerName,
      mergedData.issueDate,
      mergedData.dueDate,
      mergedData.subtotal,
      mergedData.taxAmount,
      mergedData.total,
      mergedData.status,
      mergedData.notes,
      mergedData.globalDiscountType,
      mergedData.globalDiscountValue,
      mergedData.globalDiscountAmount,
      id
    ]);

    // Only update items if they are provided
    if (totals) {
      // Delete existing items
      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

      // Insert new items
      for (let i = 0; i < updateData.items.length; i++) {
        const item = updateData.items[i];
        const itemOrder = item.order !== undefined ? item.order : (i + 1);

        const line = totals.lines[i];

        await client.query(`
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [id, item.description, item.quantity, item.unitPrice, item.taxRate, line.net, itemOrder, item.discountType || null, item.discountValue || null, line.discount || null]);
      }
    }

    // Update attachments if provided
    if (updateData.attachments) {
      // List endpoints omit attachment content, so clients may send attachments
      // without it. Keep the stored content for those (matched by id).
      const existing = await client.query('SELECT id, content FROM invoice_attachments WHERE invoice_id = $1', [id]);
      const storedContent = new Map(existing.rows.map(r => [r.id, r.content]));

      // Delete existing attachments
      await client.query('DELETE FROM invoice_attachments WHERE invoice_id = $1', [id]);

      // Insert new attachments
      for (const attachment of updateData.attachments) {
        const content = attachment.content ?? storedContent.get(attachment.id);
        await client.query(`
          INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
          VALUES ($1, $2, $3, $4, $5)
        `, [id, attachment.name, content, attachment.contentType, attachment.size]);
      }
    }

    await countReleaseIfNeeded(client, 'invoices', id, mergedData.status);

    await client.query('COMMIT');

    return await findInvoiceById(id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteInvoice(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [current] } = await client.query('SELECT status FROM invoices WHERE id = $1 FOR UPDATE', [id]);
    if (!current) {
      await client.query('ROLLBACK');
      return false;
    }
    assertDeleteAllowed(current);
    // Verknüpfte Quellen wieder abrechenbar machen (FK nur SET NULL, Status bliebe sonst invoiced/billed).
    await client.query(
      "UPDATE job_entries SET invoice_id = NULL, status = 'completed', updated_at = NOW() WHERE invoice_id = $1",
      [id]
    );
    await client.query(
      "UPDATE quotes SET converted_to_invoice_id = NULL, status = 'accepted' WHERE converted_to_invoice_id = $1",
      [id]
    );
    await client.query('DELETE FROM invoices WHERE id = $1', [id]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
