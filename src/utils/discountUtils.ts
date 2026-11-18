import { InvoiceItem, JobMaterial, JobTimeEntry, DiscountType } from '../types';

export interface TaxBreakdown {
  [taxRate: number]: {
    /** Bemessungsgrundlage nach allen Rabatten (Cent-genau) */
    taxableAmount: number;
    /** Steuer je Satz, auf Cent gerundet */
    taxAmount: number;
    /** Anteil des Gesamtrabatts an diesem Satz (Summe = globalDiscountAmount) */
    globalDiscountShare?: number;
  };
}

export interface InvoiceLineItemInput {
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountType?: DiscountType;
  discountValue?: number;
  /** Nur Altdaten ohne discountType: gespeicherter Rabattbetrag wird als Festbetrag übernommen. */
  discountAmount?: number;
}

export interface GlobalDiscountInput {
  type?: DiscountType;
  value?: number;
}

/** Cent-genaue Positionsbeträge in der Reihenfolge der Eingabe. */
export interface LineAmounts {
  gross: number;
  discount: number;
  net: number;
}

export interface DiscountCalculation {
  subtotal: number;
  itemDiscountAmount: number;
  globalDiscountAmount: number;
  totalDiscountAmount: number;
  /** Summe der Positionsnettobeträge (vor Gesamtrabatt) */
  subtotalAfterItemDiscounts: number;
  discountedSubtotal: number;
  taxAmount: number;
  taxBreakdown: TaxBreakdown;
  lines: LineAmounts[];
  hasOnlyZeroTax: boolean;
  total: number;
}

/**
 * Berechnet den Rabattbetrag für einen einzelnen Artikel
 */
export function calculateItemDiscount(
  quantity: number,
  unitPrice: number,
  discountType?: 'percentage' | 'fixed',
  discountValue?: number
): number {
  if (!discountType || !discountValue || discountValue <= 0) {
    return 0;
  }

  const itemTotal = quantity * unitPrice;

  if (discountType === 'percentage') {
    // Prozentrabatt: maximal 100%
    const percentage = Math.min(Math.max(discountValue, 0), 100);
    return (itemTotal * percentage) / 100;
  } else if (discountType === 'fixed') {
    // Festbetrag: nicht höher als der Artikelpreis
    return Math.min(Math.max(discountValue, 0), itemTotal);
  }

  return 0;
}

/**
 * Berechnet den Gesamtrabatt
 */
export function calculateGlobalDiscount(
  subtotal: number,
  globalDiscountType?: 'percentage' | 'fixed',
  globalDiscountValue?: number
): number {
  if (!globalDiscountType || !globalDiscountValue || globalDiscountValue <= 0) {
    return 0;
  }

  if (globalDiscountType === 'percentage') {
    // Prozentrabatt: maximal 100%
    const percentage = Math.min(Math.max(globalDiscountValue, 0), 100);
    return (subtotal * percentage) / 100;
  } else if (globalDiscountType === 'fixed') {
    // Festbetrag: nicht höher als die Zwischensumme
    return Math.min(Math.max(globalDiscountValue, 0), subtotal);
  }

  return 0;
}

/**
 * Kaufmännisch auf Cent runden. Fängt Gleitkommafehler ab (2,5 × 19,99 = 49,974999… → 49,98).
 */
export function roundCents(value: number): number {
  const cents = Number((Math.abs(value) * 100).toPrecision(12));
  return (Math.sign(value) * Math.round(cents)) / 100 || 0;
}

/**
 * Berechnet alle Rabatte und Gesamtsummen für eine Rechnung/ein Angebot – Cent-genau, so dass
 * die EN-16931-Summenregeln gelten (BR-CO-10/13/14/15, BR-S-08):
 * Position netto = gerundeter Betrag − gerundeter Rabatt; Gesamtrabatt anteilig je Steuersatz
 * verteilt (Rest-Cent auf den größten Satz), Steuer je Satz gerundet, Gesamtbetrag = Netto + Steuer.
 * Bei Kleinunternehmerregelung wird der Steuersatz aller Positionen intern auf 0 normalisiert.
 *
 * Spiegel im Backend: backend/utils/documentTotals.js (documentTotalsParity.test.ts).
 */
export function calculateInvoiceWithDiscounts(
  items: InvoiceLineItemInput[],
  globalDiscount: GlobalDiscountInput = {},
  isSmallBusiness = false
): DiscountCalculation {
  const normalizedItems = isSmallBusiness
    ? items.map(item => ({ ...item, taxRate: 0 }))
    : items;

  const lines: LineAmounts[] = normalizedItems.map(item => {
    const gross = roundCents(item.quantity * item.unitPrice);
    const rawDiscount = item.discountType
      ? calculateItemDiscount(item.quantity, item.unitPrice, item.discountType, item.discountValue)
      : Math.min(Math.max(item.discountAmount || 0, 0), Math.max(gross, 0));
    const discount = roundCents(rawDiscount);
    return { gross, discount, net: roundCents(gross - discount) };
  });

  const subtotal = roundCents(lines.reduce((sum, l) => sum + l.gross, 0));
  const itemDiscountAmount = roundCents(lines.reduce((sum, l) => sum + l.discount, 0));
  const subtotalAfterItemDiscounts = roundCents(subtotal - itemDiscountAmount);

  // Gesamtrabatt wird auf die bereits rabattierte Zwischensumme angewendet
  const globalDiscountAmount = roundCents(
    calculateGlobalDiscount(subtotalAfterItemDiscounts, globalDiscount.type, globalDiscount.value)
  );
  const discountedSubtotal = roundCents(subtotalAfterItemDiscounts - globalDiscountAmount);

  // Netto je Steuersatz, aufsteigend sortiert
  const netByRate = new Map<number, number>();
  normalizedItems.forEach((item, i) => {
    const rate = item.taxRate || 0;
    netByRate.set(rate, roundCents((netByRate.get(rate) ?? 0) + lines[i].net));
  });
  const rates = [...netByRate.keys()].sort((a, b) => a - b);

  // Gesamtrabatt anteilig verteilen; Rundungsrest auf den Satz mit dem größten Nettobetrag
  const shares = new Map<number, number>(rates.map(rate => [rate, 0]));
  if (globalDiscountAmount > 0 && subtotalAfterItemDiscounts > 0) {
    for (const rate of rates) {
      shares.set(rate, roundCents((globalDiscountAmount * (netByRate.get(rate) ?? 0)) / subtotalAfterItemDiscounts));
    }
    const rest = roundCents(globalDiscountAmount - [...shares.values()].reduce((a, b) => a + b, 0));
    if (rest !== 0) {
      const largest = rates.reduce((best, rate) => ((netByRate.get(rate) ?? 0) >= (netByRate.get(best) ?? 0) ? rate : best), rates[0]);
      shares.set(largest, roundCents((shares.get(largest) ?? 0) + rest));
    }
  }

  const taxBreakdown: TaxBreakdown = {};
  for (const rate of rates) {
    const globalDiscountShare = shares.get(rate) ?? 0;
    const taxableAmount = roundCents((netByRate.get(rate) ?? 0) - globalDiscountShare);
    taxBreakdown[rate] = { taxableAmount, taxAmount: roundCents((taxableAmount * rate) / 100), globalDiscountShare };
  }

  const taxAmount = roundCents(Object.values(taxBreakdown).reduce((sum, b) => sum + b.taxAmount, 0));
  const total = roundCents(discountedSubtotal + taxAmount);
  const totalDiscountAmount = roundCents(itemDiscountAmount + globalDiscountAmount);
  const hasOnlyZeroTax = normalizedItems.length > 0 && normalizedItems.every(item => item.taxRate === 0);

  return {
    subtotal,
    itemDiscountAmount,
    globalDiscountAmount,
    totalDiscountAmount,
    subtotalAfterItemDiscounts,
    discountedSubtotal,
    taxAmount,
    taxBreakdown,
    lines,
    hasOnlyZeroTax,
    total
  };
}

/**
 * Aktualisiert ein InvoiceItem mit berechneten Rabattbeträgen
 */
export function updateItemWithDiscount(item: InvoiceItem): InvoiceItem {
  // Cent-genau wie calculateInvoiceWithDiscounts (Position netto = gerundeter Betrag − gerundeter Rabatt)
  const discountAmount = roundCents(calculateItemDiscount(
    item.quantity,
    item.unitPrice,
    item.discountType,
    item.discountValue
  ));

  const itemTotal = roundCents(item.quantity * item.unitPrice);

  return {
    ...item,
    discountAmount,
    total: roundCents(itemTotal - discountAmount)
  };
}

/**
 * Formatiert Rabattinformationen für die Anzeige
 */
export function formatDiscountDisplay(
  discountType?: 'percentage' | 'fixed',
  discountValue?: number,
  discountAmount?: number
): string {
  if (!discountType || !discountValue || discountValue <= 0) {
    return '';
  }

  if (discountType === 'percentage') {
    return `${discountValue}% (${(discountAmount || 0).toFixed(2)}€)`;
  } else {
    return `${discountValue.toFixed(2)}€`;
  }
}

/**
 * Validiert Rabatteinstellungen
 */
export function validateDiscount(
  discountType?: 'percentage' | 'fixed',
  discountValue?: number,
  maxAmount?: number
): { isValid: boolean; error?: string } {
  if (!discountType || !discountValue) {
    return { isValid: true }; // Kein Rabatt ist gültig
  }

  if (discountValue < 0) {
    return { isValid: false, error: 'Rabattwert kann nicht negativ sein' };
  }

  if (discountType === 'percentage' && discountValue > 100) {
    return { isValid: false, error: 'Prozentrabatt kann nicht über 100% liegen' };
  }

  if (discountType === 'fixed' && maxAmount && discountValue > maxAmount) {
    return { isValid: false, error: `Festbetrag kann nicht höher als ${maxAmount.toFixed(2)}€ sein` };
  }

  return { isValid: true };
}

/**
 * Berechnet Rabatte für Job-Materialien
 */
export function calculateJobMaterialDiscount(material: JobMaterial): JobMaterial {
  const discountAmount = calculateItemDiscount(
    material.quantity,
    material.unitPrice,
    material.discountType,
    material.discountValue
  );

  const materialTotal = material.quantity * material.unitPrice;
  
  return {
    ...material,
    discountAmount,
    total: materialTotal - discountAmount
  };
}

/**
 * Berechnet Rabatte für Job-Zeiteinträge
 */
export function calculateJobTimeEntryDiscount(timeEntry: JobTimeEntry): JobTimeEntry {
  const discountAmount = calculateItemDiscount(
    timeEntry.hoursWorked,
    timeEntry.hourlyRate,
    timeEntry.discountType,
    timeEntry.discountValue
  );

  const entryTotal = timeEntry.hoursWorked * timeEntry.hourlyRate;
  
  return {
    ...timeEntry,
    discountAmount,
    total: entryTotal - discountAmount
  };
}
