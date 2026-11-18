import type { InvoiceStatus } from '../types';

/** Freigegeben und noch nicht beglichen. Stornierte Rechnungen sind nie offen. */
export function isOpenInvoice(status: InvoiceStatus): boolean {
  return status !== 'draft' && status !== 'paid' && status !== 'cancelled';
}

/** Überfällig bzw. gemahnt. Stornierte Rechnungen sind nie überfällig. */
export function isOverdueStatus(status: InvoiceStatus): boolean {
  return status === 'overdue' || status.startsWith('reminded_');
}
