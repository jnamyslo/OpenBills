import { describe, expect, it } from 'vitest';
import { Invoice } from '../../types';
import { draftCopyOfInvoice } from '../invoiceCopy';

const original: Invoice = {
  id: 'orig',
  invoiceNumber: 'RE-2026-007',
  customerId: 'cust',
  customerName: 'Kunde GmbH',
  issueDate: new Date('2026-10-01'),
  dueDate: new Date('2026-10-15'),
  items: [
    { id: 'i1', description: 'Arbeit', quantity: 2, unitPrice: 50, taxRate: 19, total: 90, order: 1, discountType: 'fixed', discountValue: 10, discountAmount: 10 },
  ],
  subtotal: 90,
  taxAmount: 17.1,
  total: 107.1,
  status: 'paid',
  notes: 'Danke',
  attachments: [{ id: 'a1', name: 'plan.pdf', content: 'QUJD', contentType: 'application/pdf', size: 3, uploadedAt: new Date('2026-10-01') }],
  globalDiscountType: 'percentage',
  globalDiscountValue: 5,
  globalDiscountAmount: 4.5,
  lastReminderDate: new Date('2026-10-20'),
  maxReminderStage: 1,
  invoiceType: 'invoice',
  cancelledByInvoice: { id: 'st', invoiceNumber: 'ST-2026-001' },
  cancellationReason: null,
  createdAt: new Date('2026-10-01'),
};

describe('draftCopyOfInvoice', () => {
  it('kopiert Inhalt als neuen Entwurf mit heutigem Datum und gleichem Zahlungsziel', () => {
    const copy = draftCopyOfInvoice(original, new Date(2026, 10, 18, 9, 30));

    expect(copy.status).toBe('draft');
    expect(copy.customerId).toBe('cust');
    expect(copy.notes).toBe('Danke');
    expect(copy.globalDiscountType).toBe('percentage');
    expect(copy.globalDiscountValue).toBe(5);
    expect(copy.issueDate).toEqual(new Date('2026-11-18'));
    expect(copy.dueDate).toEqual(new Date('2026-12-02'));
    expect(copy.attachments).toEqual(original.attachments);

    expect(copy.items).toHaveLength(1);
    expect(copy.items[0].id).not.toBe('i1');
    expect(copy.items[0]).toMatchObject({ description: 'Arbeit', quantity: 2, unitPrice: 50, taxRate: 19, discountType: 'fixed', discountValue: 10 });
  });

  it('übernimmt keine Storno-, Mahn- oder Nummernfelder', () => {
    const copy = draftCopyOfInvoice(original) as Partial<Invoice>;
    expect(copy.invoiceNumber).toBe('');
    expect(copy).not.toHaveProperty('invoiceType');
    expect(copy).not.toHaveProperty('cancelledByInvoice');
    expect(copy).not.toHaveProperty('cancellationReason');
    expect(copy).not.toHaveProperty('lastReminderDate');
    expect(copy).not.toHaveProperty('maxReminderStage');
  });
});
