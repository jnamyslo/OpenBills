import { describe, it, expect } from 'vitest';
import { isCancellable, isOpenInvoice, isOverdueStatus, isUnsentCancellation } from '../invoiceStatus';
import type { InvoiceStatus } from '../../types';

const ALL: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x', 'cancelled'];

describe('invoiceStatus', () => {
  it('offen sind nur freigegebene, nicht bezahlte und nicht stornierte Rechnungen', () => {
    expect(ALL.filter(isOpenInvoice)).toEqual(['sent', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']);
  });

  it('überfällig sind überfällige und gemahnte Rechnungen, stornierte nie', () => {
    expect(ALL.filter(isOverdueStatus)).toEqual(['overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']);
  });

  it('stornierbar sind freigegebene Rechnungen, keine Entwürfe, stornierten oder Stornorechnungen', () => {
    expect(ALL.filter(status => isCancellable({ status, invoiceType: 'invoice' })))
      .toEqual(['sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']);
    expect(isCancellable({ status: 'sent', invoiceType: 'cancellation' })).toBe(false);
    expect(isCancellable({ status: 'sent' })).toBe(true);
  });

  it('nicht versendet ist nur eine Stornorechnung ohne Archivfassung', () => {
    const unarchived = new Set(['st1', 're1']);
    expect(isUnsentCancellation({ id: 'st1', invoiceType: 'cancellation' }, unarchived)).toBe(true);
    expect(isUnsentCancellation({ id: 'st2', invoiceType: 'cancellation' }, unarchived)).toBe(false);
    expect(isUnsentCancellation({ id: 're1', invoiceType: 'invoice' }, unarchived)).toBe(false);
  });
});
