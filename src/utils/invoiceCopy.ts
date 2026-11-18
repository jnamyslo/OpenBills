import { Invoice } from '../types';
import { generateUUID } from './uuid';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lokales Datum als UTC-Mitternacht (wie im Rechnungseditor: `new Date('YYYY-MM-DD')`). */
function dateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * Neuer Entwurf als Kopie einer (stornierten) Rechnung für „Stornieren und neu erstellen“:
 * Rechnungsdatum heute, gleiches Zahlungsziel, neue Positions-IDs. Nummer vergibt das Backend.
 * Anhänge müssen mit Inhalt übergeben werden (`withInvoiceContent`).
 */
export function draftCopyOfInvoice(invoice: Invoice, today: Date = new Date()): Omit<Invoice, 'id' | 'createdAt'> {
  const paymentDays = Math.max(0, Math.round(
    (new Date(invoice.dueDate).getTime() - new Date(invoice.issueDate).getTime()) / DAY_MS
  ));
  const issueDate = dateOnly(today);

  return {
    invoiceNumber: '',
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    issueDate,
    dueDate: new Date(issueDate.getTime() + paymentDays * DAY_MS),
    items: invoice.items.map(item => ({ ...item, id: generateUUID() })),
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    status: 'draft',
    notes: invoice.notes,
    attachments: invoice.attachments,
    globalDiscountType: invoice.globalDiscountType,
    globalDiscountValue: invoice.globalDiscountValue,
    globalDiscountAmount: invoice.globalDiscountAmount,
  };
}
