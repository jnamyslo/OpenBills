import { describe, it, expect } from 'vitest';
import { isOpenInvoice, isOverdueStatus } from '../invoiceStatus';
import type { InvoiceStatus } from '../../types';

const ALL: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x', 'cancelled'];

describe('invoiceStatus', () => {
  it('offen sind nur freigegebene, nicht bezahlte und nicht stornierte Rechnungen', () => {
    expect(ALL.filter(isOpenInvoice)).toEqual(['sent', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']);
  });

  it('überfällig sind überfällige und gemahnte Rechnungen, stornierte nie', () => {
    expect(ALL.filter(isOverdueStatus)).toEqual(['overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x']);
  });
});
