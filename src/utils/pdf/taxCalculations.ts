/**
 * Tax calculation utilities for PDF generation
 */

import { Invoice } from '../../types';

/**
 * Check if any discounts exist in invoice items
 * @param items - Invoice items
 * @returns Whether discounts exist
 */
export function checkHasDiscounts(items: Invoice['items']): boolean {
  return items.some(item => 
    (item.discountAmount && item.discountAmount > 0) || 
    (item.discountValue && item.discountValue > 0)
  );
}

/**
 * Check if invoice has only 0% tax rate
 * @param items - Invoice items
 * @returns Whether only 0% tax rate is used
 */
export function hasOnlyZeroTaxRate(items: Invoice['items']): boolean {
  return items.length > 0 && items.every(item => item.taxRate === 0);
}

/**
 * Derive the EN 16931 VAT category code from the tax rate and business context.
 * - S  = standard rated (rate > 0)
 * - E  = exempt / Kleinunternehmer § 19 UStG (rate 0, small business)
 * - AE = reverse charge § 13b UStG (rate 0, not small business)
 * @param rate - Tax rate (percent)
 * @param isSmallBusiness - Whether the Kleinunternehmerregelung applies
 * @returns Category code
 */
export function getTaxCategoryCode(rate: number, isSmallBusiness?: boolean): string {
  if (rate > 0) return 'S';
  return isSmallBusiness ? 'E' : 'AE';
}

/**
 * Human-readable VAT exemption reason (BT-121 / ram:ExemptionReason) for a
 * given category code. Returns an empty string for categories that need none.
 * @param categoryCode - EN 16931 VAT category code
 * @returns Exemption reason text (German) or empty string
 */
export function getTaxExemptionReason(categoryCode: string): string {
  switch (categoryCode) {
    case 'E':
      return 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)';
    case 'AE':
      return 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über';
    default:
      return '';
  }
}


