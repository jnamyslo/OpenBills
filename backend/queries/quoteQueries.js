import { query } from '../database.js';

// Letzte Kundenantwort per Mail-Link (siehe docs/superpowers/specs/2026-11-17-quote-response-link.md)
const CUSTOMER_RESPONSE_JOIN = `LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
                 'decision', decision,
                 'name', responder_name,
                 'comment', comment,
                 'respondedAt', responded_at,
                 'termsUrl', terms_url,
                 'recipients', recipients,
                 'sentAt', created_at
               ) AS customer_response
        FROM quote_responses
        WHERE quote_id = q.id AND responded_at IS NOT NULL
        ORDER BY responded_at DESC
        LIMIT 1
      ) cr ON true`;

export async function findAllQuotes() {
  const result = await query(`
      SELECT q.*,
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments,
             cr.customer_response
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
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      ${CUSTOMER_RESPONSE_JOIN}
      ORDER BY q.created_at DESC
    `);

  return result.rows.map(row => ({
    id: row.id,
    quoteNumber: row.quote_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
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
    convertedToInvoiceId: row.converted_to_invoice_id,
    customerResponse: row.customer_response ?? undefined,
    createdAt: row.created_at
  }));
}

export async function findQuoteById(id) {
  const result = await query(`
      SELECT q.*,
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments,
             cr.customer_response
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
      ${CUSTOMER_RESPONSE_JOIN}
      WHERE q.id = $1
    `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
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
    convertedToInvoiceId: row.converted_to_invoice_id,
    customerResponse: row.customer_response ?? undefined,
    createdAt: row.created_at
  };
}
