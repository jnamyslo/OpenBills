import { pool, query } from '../database.js';
import { findQuoteById } from '../queries/quoteQueries.js';
import { findInvoiceById } from '../queries/invoiceQueries.js';
import { findJobById } from '../queries/jobQueries.js';
import { generateInvoiceNumber } from './invoiceService.js';
import { validateDiscountFields } from '../utils/validation.js';
import { countReleaseIfNeeded } from './quotaService.js';
import { calculateTotals } from '../utils/documentTotals.js';

export async function createQuote(data) {
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
    validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status = 'draft',
    globalDiscountType = null,
    globalDiscountValue = null,
    globalDiscountAmount = null,
  } = data;

  const maxAttempts = 5;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get customer name
    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }
    const customerName = customerResult.rows[0].name;

    // Generate quote number - format: AN-YYYY-XXX
    // Regenerated on each attempt in case a concurrent request just took this number.
    const quoteYear = new Date(issueDate).getFullYear();
    const yearPattern = `AN-${quoteYear}-%`;
    const lastQuoteResult = await client.query('SELECT quote_number FROM quotes WHERE quote_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]);

    let quoteNumber;
    if (lastQuoteResult.rows.length === 0) {
      quoteNumber = `AN-${quoteYear}-001`;
    } else {
      const lastQuoteNumber = lastQuoteResult.rows[0].quote_number;
      if (lastQuoteNumber && lastQuoteNumber.startsWith(`AN-${quoteYear}-`)) {
        const numberPart = lastQuoteNumber.substring(`AN-${quoteYear}-`.length);
        const lastNumber = parseInt(numberPart);
        if (!isNaN(lastNumber)) {
          quoteNumber = `AN-${quoteYear}-${String(lastNumber + 1).padStart(3, '0')}`;
        } else {
          quoteNumber = `AN-${quoteYear}-001`;
        }
      } else {
        quoteNumber = `AN-${quoteYear}-001`;
      }
    }

    // Calculate totals with discount support
    let subtotal = 0;
    let totalItemDiscounts = 0;

    // Group items by tax rate for proper tax calculation
    const taxBreakdown = {};

    const processedItems = items.map(item => {
      const itemTotal = item.quantity * item.unitPrice;
      const itemDiscount = item.discountAmount || 0;
      const discountedItemTotal = itemTotal - itemDiscount;
      const taxRate = item.taxRate || 0;

      subtotal += itemTotal;
      totalItemDiscounts += itemDiscount;

      // Group by tax rate for later tax calculation
      if (!taxBreakdown[taxRate]) {
        taxBreakdown[taxRate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdown[taxRate].taxableAmount += discountedItemTotal;

      return {
        ...item,
        total: discountedItemTotal // Store without tax for now
      };
    });

    // Calculate subtotal after item discounts
    const subtotalAfterItemDiscounts = subtotal - totalItemDiscounts;

    // Apply global discount
    let globalDiscountApplied = 0;

    if (globalDiscountType && globalDiscountValue) {
      if (globalDiscountType === 'percentage') {
        globalDiscountApplied = (subtotalAfterItemDiscounts * globalDiscountValue) / 100;
      } else if (globalDiscountType === 'fixed') {
        globalDiscountApplied = Math.min(globalDiscountValue, subtotalAfterItemDiscounts);
      }
    }

    // Use provided globalDiscountAmount if available, otherwise use calculated
    const finalGlobalDiscountAmount = globalDiscountAmount !== null ? globalDiscountAmount : globalDiscountApplied;

    // Calculate final subtotal after all discounts
    const discountedSubtotal = subtotalAfterItemDiscounts - finalGlobalDiscountAmount;

    // Recalculate taxes based on global discount
    // The global discount is proportionally distributed across all tax rates
    let taxAmount = 0;

    if (finalGlobalDiscountAmount > 0 && subtotalAfterItemDiscounts > 0) {
      // Proportional distribution of global discount
      const discountRatio = finalGlobalDiscountAmount / subtotalAfterItemDiscounts;

      Object.keys(taxBreakdown).forEach(taxRateStr => {
        const taxRate = Number(taxRateStr);
        const breakdown = taxBreakdown[taxRate];

        // Reduce taxable amount proportionally
        const reducedTaxableAmount = breakdown.taxableAmount * (1 - discountRatio);
        const reducedTaxAmount = (reducedTaxableAmount * taxRate) / 100;

        breakdown.taxableAmount = reducedTaxableAmount;
        breakdown.taxAmount = reducedTaxAmount;
        taxAmount += reducedTaxAmount;
      });
    } else {
      // No global discount, calculate tax normally
      Object.keys(taxBreakdown).forEach(taxRateStr => {
        const taxRate = Number(taxRateStr);
        const breakdown = taxBreakdown[taxRate];
        const itemTaxAmount = (breakdown.taxableAmount * taxRate) / 100;
        breakdown.taxAmount = itemTaxAmount;
        taxAmount += itemTaxAmount;
      });
    }

    const total = discountedSubtotal + taxAmount;

    // Insert quote - store the GROSS subtotal (before any discounts), matching
    // invoiceService and what the PDF/editor expect: the "Zwischensumme" line is
    // gross and item/global discounts are subtracted from it separately. Storing
    // the post-item-discount value here caused the Nettobetrag to double-subtract
    // the item discount (e.g. 5.00 -10% shown as 4.00 instead of 4.50).
    const quoteResult = await client.query(`
      INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [quoteNumber, customerId, customerName, issueDate, validUntil, subtotal, taxAmount, total, status, notes, globalDiscountType, globalDiscountValue, finalGlobalDiscountAmount]);

    const quoteId = quoteResult.rows[0].id;

    // Insert quote items
    for (let i = 0; i < processedItems.length; i++) {
      const item = processedItems[i];
      const itemOrder = item.order !== undefined ? item.order : (i + 1);
      await client.query(`
        INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount, kind, hourly_rate_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [quoteId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null, itemKind(item), item.hourlyRateId || null]);
    }

    // Insert attachments if provided
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO quote_attachments (quote_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [quoteId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    await countReleaseIfNeeded(client, 'quotes', quoteId, status);

    await client.query('COMMIT');

    return await findQuoteById(quoteId);
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

export async function updateQuote(id, data) {
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

    // First, get the current quote to preserve existing values
    const currentQuote = await client.query('SELECT * FROM quotes WHERE id = $1', [id]);

    if (currentQuote.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const current = currentQuote.rows[0];

    // Merge current values with updates (but preserve quote number)
    const mergedData = {
      quoteNumber: current.quote_number,
      customerId: updateData.customerId ?? current.customer_id,
      customerName: updateData.customerName ?? current.customer_name,
      issueDate: updateData.issueDate ?? current.issue_date,
      validUntil: updateData.validUntil ?? current.valid_until,
      subtotal: updateData.subtotal ?? current.subtotal,
      taxAmount: updateData.taxAmount ?? current.tax_amount,
      total: updateData.total ?? current.total,
      status: updateData.status ?? current.status,
      notes: updateData.notes ?? current.notes,
      globalDiscountType: updateData.globalDiscountType ?? current.global_discount_type,
      globalDiscountValue: updateData.globalDiscountValue ?? current.global_discount_value,
      globalDiscountAmount: updateData.globalDiscountAmount ?? current.global_discount_amount,
      items: updateData.items
    };

    // Update quote
    await client.query(`
      UPDATE quotes
      SET quote_number = $1, customer_id = $2, customer_name = $3, issue_date = $4,
          valid_until = $5, subtotal = $6, tax_amount = $7, total = $8, status = $9, notes = $10,
          global_discount_type = $11, global_discount_value = $12, global_discount_amount = $13
      WHERE id = $14
      RETURNING *
    `, [
      mergedData.quoteNumber,
      mergedData.customerId,
      mergedData.customerName,
      mergedData.issueDate,
      mergedData.validUntil,
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
    if (updateData.items) {
      // Delete existing items
      await client.query('DELETE FROM quote_items WHERE quote_id = $1', [id]);

      // Insert new items
      for (let i = 0; i < updateData.items.length; i++) {
        const item = updateData.items[i];
        const itemOrder = item.order !== undefined ? item.order : (i + 1);
        await client.query(`
          INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount, kind, hourly_rate_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [id, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null, itemKind(item), item.hourlyRateId || null]);
      }
    }

    // Update attachments if provided
    if (updateData.attachments) {
      // List endpoints omit attachment content, so clients may send attachments
      // without it. Keep the stored content for those (matched by id).
      const existing = await client.query('SELECT id, content FROM quote_attachments WHERE quote_id = $1', [id]);
      const storedContent = new Map(existing.rows.map(r => [r.id, r.content]));

      // Delete existing attachments
      await client.query('DELETE FROM quote_attachments WHERE quote_id = $1', [id]);

      // Insert new attachments
      for (const attachment of updateData.attachments) {
        const content = attachment.content ?? storedContent.get(attachment.id);
        await client.query(`
          INSERT INTO quote_attachments (quote_id, name, content, content_type, size)
          VALUES ($1, $2, $3, $4, $5)
        `, [id, attachment.name, content, attachment.contentType, attachment.size]);
      }
    }

    await countReleaseIfNeeded(client, 'quotes', id, mergedData.status);

    await client.query('COMMIT');

    return await findQuoteById(id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteQuote(id) {
  const result = await query('DELETE FROM quotes WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

export async function convertQuoteToInvoice(id) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the quote
    const quoteResult = await client.query(`
      SELECT q.*,
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order,
                   'discountType', discount_type,
                   'discountValue', discount_value,
                   'discountAmount', discount_amount,
                   'kind', kind,
                   'hourlyRateId', hourly_rate_id
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        WHERE quote_id = $1
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        WHERE quote_id = $1
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      WHERE q.id = $1
    `, [id]);

    if (quoteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'Quote not found', status: 404 };
    }

    const quote = quoteResult.rows[0];

    // Check if quote is already converted
    if (quote.converted_to_invoice_id) {
      await client.query('ROLLBACK');
      return { error: 'Quote has already been converted to an invoice', status: 400 };
    }

    // Check if quote is accepted
    if (quote.status !== 'accepted') {
      await client.query('ROLLBACK');
      return { error: 'Only accepted quotes can be converted to invoices', status: 400 };
    }

    // Existiert bereits ein Auftrag, wird über ihn abgerechnet (sonst doppelte Abrechnung).
    const existingJob = await client.query('SELECT 1 FROM job_entries WHERE quote_id = $1 LIMIT 1', [id]);
    if (existingJob.rows.length > 0) {
      await client.query('ROLLBACK');
      return { error: 'Für dieses Angebot existiert bereits ein Auftrag. Bitte über den Auftrag abrechnen.', status: 400 };
    }

    // Generate invoice number after all validation has passed
    const issueDate = new Date().toISOString().split('T')[0];
    const invoiceNumber = await generateInvoiceNumber(issueDate);

    // Summen mit den Einstellungen von heute neu rechnen: Wurde die Kleinunternehmerregelung seit dem
    // Angebot umgestellt, wären die gespeicherten Angebotssummen sonst falsch (wie beim Weg über den Auftrag).
    const companyResult = await client.query('SELECT is_small_business FROM company LIMIT 1');
    const isSmallBusiness = Boolean(companyResult.rows[0]?.is_small_business);
    const quoteItems = (quote.items || []).map((item) => ({
      quantity: parseFloat(item.quantity),
      unitPrice: parseFloat(item.unitPrice),
      taxRate: parseFloat(item.taxRate),
      discountType: item.discountType || undefined,
      discountValue: item.discountValue != null ? parseFloat(item.discountValue) : undefined,
    }));
    const hasGlobalDiscount = Boolean(quote.global_discount_type);
    const totals = calculateTotals(
      quoteItems,
      hasGlobalDiscount ? { type: quote.global_discount_type, value: parseFloat(quote.global_discount_value) } : {},
      isSmallBusiness
    );

    // Create invoice
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const invoiceResult = await client.query(`
      INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      invoiceNumber,
      quote.customer_id,
      quote.customer_name,
      issueDate,
      dueDate,
      totals.subtotal,
      totals.taxAmount,
      totals.total,
      'draft',
      quote.notes ? `Erstellt aus Angebot ${quote.quote_number}\n\n${quote.notes}` : `Erstellt aus Angebot ${quote.quote_number}`,
      quote.global_discount_type,
      quote.global_discount_value,
      hasGlobalDiscount ? totals.globalDiscountAmount : quote.global_discount_amount
    ]);

    const invoiceId = invoiceResult.rows[0].id;

    // Copy items
    const items = quote.items || [];
    for (const item of items) {
      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        invoiceId,
        item.description,
        item.quantity,
        item.unitPrice,
        isSmallBusiness ? 0 : item.taxRate,
        item.total,
        item.order,
        item.discountType || null,
        item.discountValue || null,
        item.discountAmount || null
      ]);
    }

    // Copy attachments
    const attachments = quote.attachments || [];
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [invoiceId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    // Update quote to mark as converted
    await client.query(`
      UPDATE quotes
      SET converted_to_invoice_id = $1, status = 'billed'
      WHERE id = $2
    `, [invoiceId, id]);

    await client.query('COMMIT');

    return { invoice: await findInvoiceById(invoiceId) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Art einer Angebotsposition; alles Unbekannte gilt als Material. */
function itemKind(item) {
  return item.kind === 'labor' ? 'labor' : 'material';
}

/** Nächste freie Auftragsnummer (AB-YYYY-XXX). */
async function nextJobNumber(client) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    'SELECT job_number FROM job_entries WHERE job_number LIKE $1 ORDER BY created_at DESC LIMIT 1',
    [`AB-${year}-%`]
  );
  const last = rows.length > 0 ? parseInt(rows[0].job_number.substring(`AB-${year}-`.length), 10) : 0;
  return `AB-${year}-${String((Number.isNaN(last) ? 0 : last) + 1).padStart(3, '0')}`;
}

/** Erzeugt aus einem angenommenen Angebot einen Auftrag; Positionen werden als Material übernommen. */
export async function convertQuoteToJob(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const quoteResult = await client.query('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [id]);
    if (quoteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'Quote not found', status: 404 };
    }
    const quote = quoteResult.rows[0];

    if (quote.status !== 'accepted') {
      await client.query('ROLLBACK');
      return { error: 'Nur angenommene Angebote können in einen Auftrag umgewandelt werden', status: 400 };
    }
    if (quote.converted_to_invoice_id) {
      await client.query('ROLLBACK');
      return { error: 'Das Angebot wurde bereits abgerechnet', status: 400 };
    }
    const existing = await client.query('SELECT 1 FROM job_entries WHERE quote_id = $1 LIMIT 1', [id]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { error: 'Für dieses Angebot existiert bereits ein Auftrag', status: 400 };
    }

    const itemsResult = await client.query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY item_order', [id]);
    const materials = itemsResult.rows.filter((row) => row.kind !== 'labor').map((row) => ({
      id: row.id,
      description: row.description,
      quantity: parseFloat(row.quantity),
      unitPrice: parseFloat(row.unit_price),
      taxRate: parseFloat(row.tax_rate),
      total: parseFloat(row.total),
      discountType: row.discount_type || undefined,
      discountValue: row.discount_value != null ? parseFloat(row.discount_value) : undefined,
      discountAmount: row.discount_amount != null ? parseFloat(row.discount_amount) : undefined,
    }));
    // Arbeitszeit-Positionen: Menge = Stunden, Einzelpreis = Stundensatz (ohne Start-/Endzeit)
    const laborRows = itemsResult.rows.filter((row) => row.kind === 'labor');

    const jobNumber = await nextJobNumber(client);
    const { rows } = await client.query(`
      INSERT INTO job_entries (job_number, customer_id, title, description, date, materials, status, notes, quote_id, global_discount_type, global_discount_value)
      VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, 'draft', $6, $7, $8, $9)
      RETURNING id
    `, [jobNumber, quote.customer_id, `Auftrag zu ${quote.quote_number}`, '', JSON.stringify(materials), quote.notes || null, id,
      quote.global_discount_type || null, quote.global_discount_type ? quote.global_discount_value : null]);

    for (const row of laborRows) {
      await client.query(`
        INSERT INTO job_time_entries (job_id, description, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        rows[0].id,
        (row.description || '').slice(0, 255),
        row.quantity,
        row.unit_price,
        row.hourly_rate_id || null,
        row.tax_rate,
        row.total,
        row.discount_type || null,
        row.discount_value != null ? row.discount_value : null,
        row.discount_amount != null ? row.discount_amount : null,
      ]);
    }

    await client.query('COMMIT');

    return { job: await findJobById(rows[0].id) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
