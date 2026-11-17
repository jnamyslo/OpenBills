/**
 * Belegsummen (Positions- und Gesamtrabatt, Steuer je Satz, Kleinunternehmer).
 *
 * Spiegel von calculateInvoiceWithDiscounts in src/utils/discountUtils.ts: das Backend
 * braucht die Summen, wenn es Belege selbst umwandelt (Angebot → Rechnung). Beide
 * Implementierungen werden in src/utils/__tests__/documentTotalsParity.test.ts gegeneinander
 * geprüft — bei Änderungen an der Rechenlogik beide anpassen.
 * Bewusst ohne Imports, damit der Paritätstest sie ohne Datenbank laden kann.
 */

function itemDiscount(quantity, unitPrice, type, value) {
  if (!type || !value || value <= 0) return 0;
  const total = quantity * unitPrice;
  if (type === 'percentage') return (total * Math.min(Math.max(value, 0), 100)) / 100;
  if (type === 'fixed') return Math.min(Math.max(value, 0), total);
  return 0;
}

export function calculateTotals(items, globalDiscount = {}, isSmallBusiness = false) {
  const normalized = isSmallBusiness ? items.map((item) => ({ ...item, taxRate: 0 })) : items;

  let subtotal = 0;
  let itemDiscountAmount = 0;
  const breakdown = {};

  for (const item of normalized) {
    const itemTotal = item.quantity * item.unitPrice;
    const discount = itemDiscount(item.quantity, item.unitPrice, item.discountType, item.discountValue);
    subtotal += itemTotal;
    itemDiscountAmount += discount;
    const taxRate = item.taxRate || 0;
    const taxable = itemTotal - discount;
    breakdown[taxRate] ??= { taxableAmount: 0, taxAmount: 0 };
    breakdown[taxRate].taxableAmount += taxable;
    breakdown[taxRate].taxAmount += (taxable * taxRate) / 100;
  }

  const afterItemDiscounts = subtotal - itemDiscountAmount;

  let globalDiscountAmount = 0;
  const { type, value } = globalDiscount;
  if (type && value && value > 0) {
    globalDiscountAmount = type === 'percentage'
      ? (afterItemDiscounts * Math.min(Math.max(value, 0), 100)) / 100
      : type === 'fixed' ? Math.min(Math.max(value, 0), afterItemDiscounts) : 0;
  }

  const discountedSubtotal = afterItemDiscounts - globalDiscountAmount;

  let taxAmount = 0;
  if (globalDiscountAmount > 0 && afterItemDiscounts > 0) {
    const ratio = globalDiscountAmount / afterItemDiscounts;
    for (const [rate, b] of Object.entries(breakdown)) {
      taxAmount += (b.taxableAmount * (1 - ratio) * Number(rate)) / 100;
    }
  } else {
    taxAmount = Object.values(breakdown).reduce((sum, b) => sum + b.taxAmount, 0);
  }

  return { subtotal, itemDiscountAmount, globalDiscountAmount, discountedSubtotal, taxAmount, total: discountedSubtotal + taxAmount };
}
