import { calculateTotals } from '../utils/documentTotals.js';

/**
 * Cent-genaue Belegsummen mit derselben Logik wie das Frontend (utils/documentTotals.js ↔ discountUtils.ts),
 * inkl. Kleinunternehmerregelung der Firma. Rabattbeträge werden aus Typ/Wert neu berechnet,
 * nicht vom Client übernommen. Läuft in der Transaktion des Aufrufers (client).
 */
export async function computeDocumentTotals(client, items, globalDiscountType, globalDiscountValue) {
  const { rows } = await client.query('SELECT is_small_business FROM company LIMIT 1');
  const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  return calculateTotals(
    items.map((item) => ({
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      taxRate: Number(item.taxRate) || 0,
      discountType: item.discountType || undefined,
      discountValue: num(item.discountValue),
      discountAmount: num(item.discountAmount),
    })),
    globalDiscountType ? { type: globalDiscountType, value: num(globalDiscountValue) } : {},
    Boolean(rows[0]?.is_small_business)
  );
}
