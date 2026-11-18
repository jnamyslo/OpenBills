/**
 * Belegsummen (Positions- und Gesamtrabatt, Steuer je Satz, Kleinunternehmer).
 *
 * Spiegel von calculateInvoiceWithDiscounts in src/utils/discountUtils.ts: das Backend speichert
 * Rechnungen/Angebote mit diesen Summen (services/documentTotalsService.js) und nutzt sie beim
 * Umwandeln (Angebot → Rechnung). Cent-genau nach EN 16931 (siehe dort). Beide
 * Implementierungen werden in src/utils/__tests__/documentTotalsParity.test.ts gegeneinander
 * geprüft — bei Änderungen an der Rechenlogik beide anpassen.
 * Bewusst ohne Imports, damit der Paritätstest sie ohne Datenbank laden kann.
 */

/** Kaufmännisch auf Cent runden; fängt Gleitkommafehler ab (49,974999… → 49,98). */
export function roundCents(value) {
  const cents = Number((Math.abs(value) * 100).toPrecision(12));
  return (Math.sign(value) * Math.round(cents)) / 100 || 0;
}

function itemDiscount(quantity, unitPrice, type, value) {
  if (!type || !value || value <= 0) return 0;
  const total = quantity * unitPrice;
  if (type === 'percentage') return (total * Math.min(Math.max(value, 0), 100)) / 100;
  if (type === 'fixed') return Math.min(Math.max(value, 0), total);
  return 0;
}

function globalDiscountOf(base, { type, value } = {}) {
  if (!type || !value || value <= 0) return 0;
  if (type === 'percentage') return (base * Math.min(Math.max(value, 0), 100)) / 100;
  if (type === 'fixed') return Math.min(Math.max(value, 0), base);
  return 0;
}

/**
 * Cent-genaue Belegsummen (EN 16931: BR-CO-10/13/14/15, BR-S-08). Siehe calculateInvoiceWithDiscounts.
 * items: { quantity, unitPrice, taxRate, discountType?, discountValue?, discountAmount? (nur Altdaten ohne Typ) }
 */
export function calculateTotals(items, globalDiscount = {}, isSmallBusiness = false) {
  const normalized = isSmallBusiness ? items.map((item) => ({ ...item, taxRate: 0 })) : items;

  const lines = normalized.map((item) => {
    const gross = roundCents(item.quantity * item.unitPrice);
    const rawDiscount = item.discountType
      ? itemDiscount(item.quantity, item.unitPrice, item.discountType, item.discountValue)
      : Math.min(Math.max(item.discountAmount || 0, 0), Math.max(gross, 0));
    const discount = roundCents(rawDiscount);
    return { gross, discount, net: roundCents(gross - discount) };
  });

  const subtotal = roundCents(lines.reduce((sum, l) => sum + l.gross, 0));
  const itemDiscountAmount = roundCents(lines.reduce((sum, l) => sum + l.discount, 0));
  const subtotalAfterItemDiscounts = roundCents(subtotal - itemDiscountAmount);
  const globalDiscountAmount = roundCents(globalDiscountOf(subtotalAfterItemDiscounts, globalDiscount));
  const discountedSubtotal = roundCents(subtotalAfterItemDiscounts - globalDiscountAmount);

  const netByRate = new Map();
  normalized.forEach((item, i) => {
    const rate = item.taxRate || 0;
    netByRate.set(rate, roundCents((netByRate.get(rate) ?? 0) + lines[i].net));
  });
  const rates = [...netByRate.keys()].sort((a, b) => a - b);

  const shares = new Map(rates.map((rate) => [rate, 0]));
  if (globalDiscountAmount > 0 && subtotalAfterItemDiscounts > 0) {
    for (const rate of rates) {
      shares.set(rate, roundCents((globalDiscountAmount * netByRate.get(rate)) / subtotalAfterItemDiscounts));
    }
    const rest = roundCents(globalDiscountAmount - [...shares.values()].reduce((a, b) => a + b, 0));
    if (rest !== 0) {
      const largest = rates.reduce((best, rate) => (netByRate.get(rate) >= netByRate.get(best) ? rate : best), rates[0]);
      shares.set(largest, roundCents(shares.get(largest) + rest));
    }
  }

  const taxBreakdown = {};
  for (const rate of rates) {
    const globalDiscountShare = shares.get(rate);
    const taxableAmount = roundCents(netByRate.get(rate) - globalDiscountShare);
    taxBreakdown[rate] = { taxableAmount, taxAmount: roundCents((taxableAmount * rate) / 100), globalDiscountShare };
  }

  const taxAmount = roundCents(Object.values(taxBreakdown).reduce((sum, b) => sum + b.taxAmount, 0));
  return {
    subtotal,
    itemDiscountAmount,
    globalDiscountAmount,
    subtotalAfterItemDiscounts,
    discountedSubtotal,
    taxAmount,
    taxBreakdown,
    lines,
    total: roundCents(discountedSubtotal + taxAmount),
  };
}
