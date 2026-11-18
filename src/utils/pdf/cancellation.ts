/**
 * Stornorechnungen (Spec docs/superpowers/specs/2026-11-17-document-archive-storno.md § 3).
 *
 * Das Backend speichert Stornorechnungen mit negierten Mengen, Rabattbeträgen und Summen.
 * Die Rechenlogik (discountUtils) schneidet negative Werte ab; die Generatoren rechnen deshalb
 * auf der positiven Originalbasis und setzen das Vorzeichen erst bei der Ausgabe. So sind alle
 * Beträge exakt die negierten Beträge der Originalrechnung (auch nach dem Runden).
 */

import { Invoice } from '../../types';

export function isCancellation(invoice: Invoice): boolean {
  return invoice.invoiceType === 'cancellation';
}

/** -1 für Stornorechnungen, sonst 1. */
export function amountSign(invoice: Invoice): 1 | -1 {
  return isCancellation(invoice) ? -1 : 1;
}

const neg = (v: number | undefined): number | undefined => (v === undefined || v === null ? v : -v);

/** Stornorechnung mit positiven Mengen/Beträgen (= Originalrechnung); andere Rechnungen unverändert. */
export function toPositiveBase(invoice: Invoice): Invoice {
  if (!isCancellation(invoice)) return invoice;
  return {
    ...invoice,
    subtotal: -invoice.subtotal,
    taxAmount: -invoice.taxAmount,
    total: -invoice.total,
    globalDiscountAmount: neg(invoice.globalDiscountAmount),
    globalDiscountValue: invoice.globalDiscountType === 'fixed' ? neg(invoice.globalDiscountValue) : invoice.globalDiscountValue,
    items: invoice.items.map(item => ({
      ...item,
      quantity: -item.quantity,
      total: -item.total,
      discountAmount: neg(item.discountAmount),
      discountValue: item.discountType === 'fixed' ? neg(item.discountValue) : item.discountValue,
    })),
  };
}

/** Originalrechnung einer Stornorechnung (BG-3); ohne sie wäre die E-Rechnung ungültig. */
export function cancelledInvoiceRef(invoice: Invoice): { invoiceNumber: string; issueDate: string } {
  const ref = invoice.cancelsInvoice;
  if (!ref?.invoiceNumber || !ref.issueDate) {
    throw new Error('Stornorechnung ohne Bezug auf die Originalrechnung');
  }
  return { invoiceNumber: ref.invoiceNumber, issueDate: new Date(ref.issueDate).toISOString().split('T')[0] };
}

/** „Storno zur Rechnung RE-… vom TT.MM.JJJJ.“ plus Grund – für PDF und E-Rechnung (BT-22). */
export function cancellationNote(invoice: Invoice, locale = 'de-DE'): string {
  const ref = cancelledInvoiceRef(invoice);
  const date = new Date(ref.issueDate).toLocaleDateString(locale, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  const lines = [`Storno zur Rechnung ${ref.invoiceNumber} vom ${date}.`];
  if (invoice.cancellationReason) lines.push(`Grund: ${invoice.cancellationReason}`);
  return lines.join('\n');
}
