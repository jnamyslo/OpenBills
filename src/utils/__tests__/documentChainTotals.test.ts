import { describe, it, expect } from 'vitest';
import { calculateInvoiceWithDiscounts, InvoiceLineItemInput } from '../discountUtils';
import { buildInvoiceFromJobs, groupJobsByGlobalDiscount } from '../jobInvoiceItems';
import type { DiscountType, JobEntry, JobMaterial } from '../../types';

/**
 * Summen entlang der Belegkette Angebot → Auftrag → Rechnung.
 *
 * Der Auftrag entsteht so, wie ihn POST /quotes/:id/convert-to-job liefert
 * (Positionen 1:1 als Material, Gesamtrabatt als Art+Wert; Vertrag im Backend-Test
 * tests/documentChain.test.js). Die Rechnung entsteht über buildInvoiceFromJobs
 * wie im JobInvoiceGenerator. Direkte Abrechnung kopiert Positionen und Summen.
 */

interface QuoteFixture {
  items: (InvoiceLineItemInput & { description: string })[];
  discount: { type?: DiscountType; value?: number };
}

const cents = (n: number) => Math.round(n * 100) / 100;

const ITEM_SETS: Record<string, QuoteFixture['items']> = {
  'ein Steuersatz 19 %': [
    { description: 'Montage', quantity: 2, unitPrice: 50, taxRate: 19 },
    { description: 'Anfahrt', quantity: 1, unitPrice: 30, taxRate: 19 },
  ],
  'gemischte Sätze 19/7/0 %': [
    { description: 'Montage', quantity: 3, unitPrice: 49.9, taxRate: 19 },
    { description: 'Buch', quantity: 2, unitPrice: 14.95, taxRate: 7 },
    { description: 'Auslage', quantity: 1, unitPrice: 12.34, taxRate: 0 },
  ],
  'mit Positionsrabatten': [
    { description: 'Montage', quantity: 4, unitPrice: 33.33, taxRate: 19, discountType: 'percentage', discountValue: 12.5 },
    { description: 'Material', quantity: 7, unitPrice: 3.19, taxRate: 7, discountType: 'fixed', discountValue: 2.5 },
  ],
};

const DISCOUNTS: Record<string, QuoteFixture['discount']> = {
  'ohne Gesamtrabatt': {},
  'Gesamtrabatt 10 %': { type: 'percentage', value: 10 },
  'Gesamtrabatt 15 €': { type: 'fixed', value: 15 },
};

function jobFromQuote(id: string, quote: QuoteFixture, extra: Partial<JobEntry> = {}): JobEntry {
  const materials: JobMaterial[] = quote.items.map((item, i) => ({
    id: `m-${id}-${i}`,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
    discountType: item.discountType,
    discountValue: item.discountValue,
    total: item.quantity * item.unitPrice,
  }));
  return {
    id,
    jobNumber: `AB-2026-${id}`,
    customerId: 'c1',
    customerName: 'Kunde',
    title: `Auftrag ${id}`,
    description: '',
    date: new Date('2026-11-16'),
    hoursWorked: 0,
    hourlyRate: 0,
    materials,
    status: 'completed',
    globalDiscountType: quote.discount.type,
    globalDiscountValue: quote.discount.value,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  } as JobEntry;
}

const matrix = Object.entries(ITEM_SETS).flatMap(([itemName, items]) =>
  Object.entries(DISCOUNTS).flatMap(([discName, discount]) =>
    [false, true].map(small => ({ itemName, discName, small, quote: { items, discount } }))
  )
);

describe.each(matrix)('Summen Angebot → Auftrag → Rechnung: $itemName, $discName, Kleinunternehmer=$small', ({ quote, small }) => {
  const quoteTotals = calculateInvoiceWithDiscounts(quote.items, quote.discount, small);

  it('Rechnung über den Auftrag hat dieselben Summen wie das Angebot', () => {
    const invoice = buildInvoiceFromJobs([jobFromQuote('1', quote)], small);
    expect(cents(invoice.subtotal)).toBe(cents(quoteTotals.subtotal));
    expect(cents(invoice.taxAmount)).toBe(cents(quoteTotals.taxAmount));
    expect(cents(invoice.total)).toBe(cents(quoteTotals.total));
  });

  it('übernimmt den Gesamtrabatt mit Art, Wert und Betrag auf die Rechnung', () => {
    const invoice = buildInvoiceFromJobs([jobFromQuote('1', quote)], small);
    expect(invoice.globalDiscountType).toBe(quote.discount.type);
    expect(invoice.globalDiscountValue).toBe(quote.discount.value);
    expect(cents(invoice.globalDiscountAmount ?? 0)).toBe(cents(quote.discount.type ? quoteTotals.globalDiscountAmount : 0));
  });

  it('Positionen der Rechnung entsprechen den Angebotspositionen (Menge, Preis, Rabatt, Steuersatz)', () => {
    const invoice = buildInvoiceFromJobs([jobFromQuote('1', quote)], small);
    expect(invoice.items).toHaveLength(quote.items.length);
    invoice.items.forEach((item, i) => {
      const src = quote.items[i];
      expect(item.quantity).toBe(src.quantity);
      expect(item.unitPrice).toBe(src.unitPrice);
      expect(item.discountType).toBe(src.discountType);
      expect(item.discountValue).toBe(src.discountValue);
      expect(item.taxRate).toBe(small ? 0 : src.taxRate);
    });
  });

  it('Summen sind in sich schlüssig', () => {
    const t = quoteTotals;
    expect(cents(t.total)).toBe(cents(t.subtotal - t.itemDiscountAmount - t.globalDiscountAmount + t.taxAmount));
    const breakdownTax = Object.values(t.taxBreakdown).reduce((sum, b) => sum + b.taxAmount, 0);
    expect(cents(breakdownTax)).toBe(cents(t.taxAmount));
    if (small) {
      expect(t.taxAmount).toBe(0);
      expect(cents(t.total)).toBe(cents(t.discountedSubtotal));
    }
  });

  it('direkte Abrechnung (Positionen kopiert) ergibt dieselbe Summe wie das Angebot', () => {
    const direct = calculateInvoiceWithDiscounts([...quote.items], quote.discount, small);
    expect(cents(direct.total)).toBe(cents(quoteTotals.total));
  });
});

describe('Kleinunternehmerregelung wird erst bei der Rechnung angewendet', () => {
  it('Angebot mit Steuer, Rechnung als Kleinunternehmer: keine Steuer, Netto bleibt', () => {
    const quote: QuoteFixture = { items: ITEM_SETS['gemischte Sätze 19/7/0 %'], discount: { type: 'percentage', value: 10 } };
    const withTax = calculateInvoiceWithDiscounts(quote.items, quote.discount, false);
    const invoice = buildInvoiceFromJobs([jobFromQuote('1', quote)], true);
    expect(invoice.taxAmount).toBe(0);
    expect(cents(invoice.total)).toBe(cents(withTax.discountedSubtotal));
  });
});

describe('Auftrag mit Zeiteinträgen zusätzlich zum Angebotsmaterial', () => {
  it('Prozentrabatt wirkt auch auf die zusätzlichen Zeiteinträge', () => {
    const quote: QuoteFixture = { items: ITEM_SETS['gemischte Sätze 19/7/0 %'], discount: { type: 'percentage', value: 10 } };
    const job = jobFromQuote('1', quote, {
      timeEntries: [{ id: 't1', description: 'Arbeitszeit', hoursWorked: 2.5, hourlyRate: 60, taxRate: 19, total: 150 }],
    });
    const invoice = buildInvoiceFromJobs([job], false);
    const expected = calculateInvoiceWithDiscounts(
      [{ quantity: 2.5, unitPrice: 60, taxRate: 19 }, ...quote.items],
      quote.discount
    );
    expect(cents(invoice.total)).toBe(cents(expected.total));
  });
});

describe('Sammelrechnung mehrerer Aufträge', () => {
  const quoteA: QuoteFixture = { items: ITEM_SETS['ein Steuersatz 19 %'], discount: { type: 'percentage', value: 10 } };
  const quoteB: QuoteFixture = { items: ITEM_SETS['gemischte Sätze 19/7/0 %'], discount: { type: 'percentage', value: 10 } };
  const sum = (jobs: JobEntry[], small: boolean) =>
    jobs.reduce((acc, job) => acc + buildInvoiceFromJobs([job], small).total, 0);

  it.each([false, true])('gleicher Prozentrabatt: eine Rechnung = Summe der Einzelrechnungen (Kleinunternehmer=%s)', (small) => {
    const jobs = [jobFromQuote('1', quoteA), jobFromQuote('2', quoteB)];
    expect(groupJobsByGlobalDiscount(jobs)).toHaveLength(1);
    expect(cents(buildInvoiceFromJobs(jobs, small).total)).toBe(cents(sum(jobs, small)));
  });

  it('Aufträge ohne und mit Gesamtrabatt werden getrennt', () => {
    const jobs = [jobFromQuote('1', quoteA), jobFromQuote('2', { ...quoteB, discount: {} })];
    expect(groupJobsByGlobalDiscount(jobs)).toHaveLength(2);
  });

  it('unterschiedliche Prozentsätze werden getrennt', () => {
    const jobs = [jobFromQuote('1', quoteA), jobFromQuote('2', { ...quoteB, discount: { type: 'percentage', value: 5 } })];
    expect(groupJobsByGlobalDiscount(jobs)).toHaveLength(2);
  });

  it('Festbeträge werden nie zusammengefasst, auch bei gleichem Betrag', () => {
    const fixed = { type: 'fixed' as const, value: 15 };
    const jobs = [jobFromQuote('1', { ...quoteA, discount: fixed }), jobFromQuote('2', { ...quoteB, discount: fixed })];
    expect(groupJobsByGlobalDiscount(jobs)).toHaveLength(2);
  });

  it('Gruppen ergeben zusammen dieselbe Summe wie die Einzelrechnungen', () => {
    const jobs = [
      jobFromQuote('1', quoteA),
      jobFromQuote('2', { ...quoteB, discount: { type: 'fixed', value: 15 } }),
      jobFromQuote('3', { ...quoteB, discount: {} }),
    ];
    const grouped = groupJobsByGlobalDiscount(jobs).reduce((acc, g) => acc + buildInvoiceFromJobs(g, false).total, 0);
    expect(cents(grouped)).toBe(cents(sum(jobs, false)));
  });

  it('weigert sich, unverträgliche Aufträge zu einer Rechnung zusammenzufassen', () => {
    const jobs = [jobFromQuote('1', quoteA), jobFromQuote('2', { ...quoteB, discount: {} })];
    expect(() => buildInvoiceFromJobs(jobs, false)).toThrow(/Gesamtrabatt/);
  });
});
