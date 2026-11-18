import { query } from '../database.js';

// Storno-Bezug (Migration 015): Stornorechnung → Original (cancelsInvoice), Original → Storno (cancelledByInvoice)
function cancellationFields(row) {
  return {
    invoiceType: row.invoice_type,
    cancelsInvoiceId: row.cancels_invoice_id,
    cancelsInvoice: row.cancels_invoice_id
      ? { id: row.cancels_invoice_id, invoiceNumber: row.cancels_invoice_number, issueDate: row.cancels_invoice_issue_date }
      : null,
    cancelledByInvoice: row.cancelled_by_id ? { id: row.cancelled_by_id, invoiceNumber: row.cancelled_by_number } : null,
    cancellationReason: row.cancellation_reason,
  };
}

export async function findAllInvoices() {
  const result = await query(`
      SELECT i.*,
             orig.invoice_number AS cancels_invoice_number, orig.issue_date AS cancels_invoice_issue_date,
             st.id AS cancelled_by_id, st.invoice_number AS cancelled_by_number,
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM invoices i
      LEFT JOIN invoices orig ON orig.id = i.cancels_invoice_id
      LEFT JOIN invoices st ON st.cancels_invoice_id = i.id
      LEFT JOIN (
        SELECT invoice_id,
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
                   'discountAmount', discount_amount
                 ) ORDER BY item_order
               ) as items
        FROM invoice_items
        GROUP BY invoice_id
      ) items_subquery ON i.id = items_subquery.invoice_id
      LEFT JOIN (
        SELECT invoice_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM invoice_attachments
        GROUP BY invoice_id
      ) attachments_subquery ON i.id = attachments_subquery.invoice_id
      ORDER BY i.created_at DESC
    `);

  return result.rows.map(row => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    items: row.items || [],
    attachments: row.attachments || [],
    subtotal: parseFloat(row.subtotal),
    taxAmount: parseFloat(row.tax_amount),
    total: parseFloat(row.total),
    status: row.status,
    notes: row.notes,
    globalDiscountType: row.global_discount_type,
    globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
    globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
    createdAt: row.created_at,
    ...cancellationFields(row),
  }));
}

export async function findInvoiceById(id) {
  const result = await query(`
      SELECT i.*,
             orig.invoice_number AS cancels_invoice_number, orig.issue_date AS cancels_invoice_issue_date,
             st.id AS cancelled_by_id, st.invoice_number AS cancelled_by_number,
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM invoices i
      LEFT JOIN invoices orig ON orig.id = i.cancels_invoice_id
      LEFT JOIN invoices st ON st.cancels_invoice_id = i.id
      LEFT JOIN (
        SELECT invoice_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order
                 ) ORDER BY item_order
               ) as items
        FROM invoice_items
        WHERE invoice_id = $1
        GROUP BY invoice_id
      ) items_subquery ON i.id = items_subquery.invoice_id
      LEFT JOIN (
        SELECT invoice_id,
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
        FROM invoice_attachments
        WHERE invoice_id = $1
        GROUP BY invoice_id
      ) attachments_subquery ON i.id = attachments_subquery.invoice_id
      WHERE i.id = $1
    `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    items: row.items || [],
    attachments: row.attachments || [],
    subtotal: parseFloat(row.subtotal),
    taxAmount: parseFloat(row.tax_amount),
    total: parseFloat(row.total),
    status: row.status,
    notes: row.notes,
    globalDiscountType: row.global_discount_type,
    globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
    globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
    createdAt: row.created_at,
    ...cancellationFields(row),
  };
}
