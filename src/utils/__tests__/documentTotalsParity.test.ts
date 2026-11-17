import { describe, it, expect } from 'vitest';
import { calculateInvoiceWithDiscounts, InvoiceLineItemInput } from '../discountUtils';

type Totals = {
  subtotal: number; itemDiscountAmount: number; globalDiscountAmount: number; taxAmount: number; total: number;
};
type CalculateTotals = (items: InvoiceLineItemInput[], discount: object, small: boolean) => Totals;

// Das Frontend-Image wird ohne backend/ gebaut (.dockerignore). import.meta.glob liefert dann {} statt
// eines Importfehlers; der Test wird übersprungen und läuft im vollen Repo (und in CI mit Backend).
const backendModule = Object.values(import.meta.glob('../../../backend/utils/documentTotals.js'))[0];
const calculateTotals = backendModule
  ? ((await backendModule()) as { calculateTotals: CalculateTotals }).calculateTotals
  : undefined;

/**
 * Das Backend rechnet bei der direkten Abrechnung (Angebot → Rechnung) selbst nach.
 * Diese Tests stellen sicher, dass seine Summen mit denen des Frontends identisch bleiben.
 */

const ITEM_SETS: Record<string, InvoiceLineItemInput[]> = {
  leer: [],
  'ein Satz': [{ quantity: 2, unitPrice: 50, taxRate: 19 }],
  'gemischt': [
    { quantity: 3, unitPrice: 49.9, taxRate: 19 },
    { quantity: 2, unitPrice: 14.95, taxRate: 7 },
    { quantity: 1, unitPrice: 12.34, taxRate: 0 },
  ],
  'Positionsrabatte': [
    { quantity: 4, unitPrice: 33.33, taxRate: 19, discountType: 'percentage', discountValue: 12.5 },
    { quantity: 7, unitPrice: 3.19, taxRate: 7, discountType: 'fixed', discountValue: 2.5 },
  ],
  'Rabatt über Positionspreis': [
    { quantity: 1, unitPrice: 10, taxRate: 19, discountType: 'fixed', discountValue: 50 },
    { quantity: 1, unitPrice: 10, taxRate: 7, discountType: 'percentage', discountValue: 150 },
  ],
  'Menge 0': [{ quantity: 0, unitPrice: 99, taxRate: 19 }],
};

const DISCOUNTS = [
  {},
  { type: 'percentage' as const, value: 10 },
  { type: 'percentage' as const, value: 100 },
  { type: 'percentage' as const, value: 150 },
  { type: 'fixed' as const, value: 15 },
  { type: 'fixed' as const, value: 100000 },
];

describe.skipIf(!calculateTotals)('Backend- und Frontend-Summen stimmen überein', () => {
describe.each(Object.entries(ITEM_SETS))('%s', (_name, items) => {
  it.each(DISCOUNTS.flatMap(d => [false, true].map(small => [JSON.stringify(d), d, small] as const)))(
    'Gesamtrabatt %s, Kleinunternehmer=%s',
    (_label, discount, small) => {
      const front = calculateInvoiceWithDiscounts(items, discount, small);
      const back = calculateTotals!(items, discount, small);
      expect(back.subtotal).toBeCloseTo(front.subtotal, 9);
      expect(back.itemDiscountAmount).toBeCloseTo(front.itemDiscountAmount, 9);
      expect(back.globalDiscountAmount).toBeCloseTo(front.globalDiscountAmount, 9);
      expect(back.taxAmount).toBeCloseTo(front.taxAmount, 9);
      expect(back.total).toBeCloseTo(front.total, 9);
    }
  );
});
});
