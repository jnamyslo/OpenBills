import { describe, it, expect } from 'vitest';
import { calculateInvoiceWithDiscounts, roundCents, updateItemWithDiscount, InvoiceLineItemInput } from '../discountUtils';
import { InvoiceItem } from '../../types';

/**
 * Cent-genaue Summen: dieselben Regeln, die der KoSIT-Validator an der E-Rechnung prüft.
 *   BR-CO-10  Summe Positionsnetto == Kopf-Nettosumme
 *   BR-CO-13  Netto nach Rabatt == Kopf-Netto − Gesamtrabatt
 *   BR-CO-14  Kopfsteuer == Summe der Steuer je Satz
 *   BR-CO-15  Gesamtbetrag == Netto nach Rabatt + Steuer
 *   BR-S-08   Bemessungsgrundlage je Satz == Positionsnetto des Satzes − Rabattanteil
 */

const cents = (n: number) => Math.round(n * 100);
const sum = (list: number[]) => list.reduce((a, b) => a + cents(b), 0);

const CASES: Record<string, InvoiceLineItemInput[]> = {
  'halbe Cents + zwei Sätze': [
    { quantity: 3, unitPrice: 33.33, taxRate: 19, discountType: 'fixed', discountValue: 10 },
    { quantity: 2.5, unitPrice: 19.99, taxRate: 7, discountType: 'percentage', discountValue: 10 },
    { quantity: 1, unitPrice: 25, taxRate: 19 },
  ],
  'drei Sätze, krumme Preise': [
    { quantity: 7, unitPrice: 3.19, taxRate: 19, discountType: 'percentage', discountValue: 12.5 },
    { quantity: 1.333, unitPrice: 14.95, taxRate: 7 },
    { quantity: 3, unitPrice: 0.333, taxRate: 0 },
  ],
  'ein Satz': [{ quantity: 1, unitPrice: 0.01, taxRate: 19 }],
};
const DISCOUNTS = [{}, { type: 'percentage' as const, value: 5 }, { type: 'percentage' as const, value: 33.3 }, { type: 'fixed' as const, value: 7.77 }];

describe('calculateInvoiceWithDiscounts – Cent-genau (EN 16931)', () => {
  for (const [name, items] of Object.entries(CASES)) {
    for (const discount of DISCOUNTS) {
      it(`${name}, Gesamtrabatt ${JSON.stringify(discount)}`, () => {
        const c = calculateInvoiceWithDiscounts(items, discount);
        const rates = Object.keys(c.taxBreakdown).map(Number);

        // alle Beträge sind ganze Cent
        for (const v of [c.subtotal, c.itemDiscountAmount, c.globalDiscountAmount, c.discountedSubtotal, c.taxAmount, c.total,
          ...c.lines.flatMap(l => [l.gross, l.discount, l.net]),
          ...rates.flatMap(r => [c.taxBreakdown[r].taxableAmount, c.taxBreakdown[r].taxAmount, c.taxBreakdown[r].globalDiscountShare ?? 0])]) {
          expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
        }

        expect(sum(c.lines.map(l => l.net))).toBe(cents(c.subtotalAfterItemDiscounts)); // BR-CO-10
        expect(cents(c.subtotalAfterItemDiscounts) - cents(c.globalDiscountAmount)).toBe(cents(c.discountedSubtotal)); // BR-CO-13
        expect(sum(rates.map(r => c.taxBreakdown[r].taxAmount))).toBe(cents(c.taxAmount)); // BR-CO-14
        expect(cents(c.discountedSubtotal) + cents(c.taxAmount)).toBe(cents(c.total)); // BR-CO-15
        expect(sum(rates.map(r => c.taxBreakdown[r].globalDiscountShare ?? 0))).toBe(cents(c.globalDiscountAmount));
        for (const rate of rates) { // BR-S-08
          const lineNet = sum(c.lines.filter((_, i) => (items[i].taxRate || 0) === rate).map(l => l.net));
          expect(lineNet - cents(c.taxBreakdown[rate].globalDiscountShare ?? 0)).toBe(cents(c.taxBreakdown[rate].taxableAmount));
          expect(cents(c.taxBreakdown[rate].taxAmount)).toBe(cents(roundCents(c.taxBreakdown[rate].taxableAmount * rate / 100)));
        }
      });
    }
  }

  it('rundet kaufmännisch trotz Gleitkommafehler', () => {
    expect(roundCents(2.5 * 19.99)).toBe(49.98);
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
  });

  it('Beispiel aus dem KoSIT-Lauf: 151,97 + (20,76 + 2,99) = 175,72', () => {
    const c = calculateInvoiceWithDiscounts(CASES['halbe Cents + zwei Sätze'], { type: 'percentage', value: 5 });
    expect(c.lines.map(l => l.net)).toEqual([89.99, 44.98, 25]);
    expect(c.globalDiscountAmount).toBe(8);
    expect(c.taxBreakdown[19]).toEqual({ taxableAmount: 109.24, taxAmount: 20.76, globalDiscountShare: 5.75 });
    expect(c.taxBreakdown[7]).toEqual({ taxableAmount: 42.73, taxAmount: 2.99, globalDiscountShare: 2.25 });
    expect(c.discountedSubtotal).toBe(151.97);
    expect(c.total).toBe(175.72);
  });

  it('übernimmt bei Altdaten ohne Rabatttyp den gespeicherten Rabattbetrag', () => {
    const c = calculateInvoiceWithDiscounts([{ quantity: 2, unitPrice: 40, taxRate: 19, discountAmount: 7.5 }]);
    expect(c.lines).toEqual([{ gross: 80, discount: 7.5, net: 72.5 }]);
  });

  it('updateItemWithDiscount liefert dieselben Cent-Beträge wie die Summenberechnung', () => {
    const item = updateItemWithDiscount({ id: 'x', description: 'x', quantity: 2.5, unitPrice: 19.99, taxRate: 7, discountType: 'percentage', discountValue: 10, total: 0 } as InvoiceItem);
    const [line] = calculateInvoiceWithDiscounts([item]).lines;
    expect([item.discountAmount, item.total]).toEqual([line.discount, line.net]);
  });
});
