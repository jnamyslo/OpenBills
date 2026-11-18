import { describe, it, expect } from 'vitest';
import { generateXRechnungXML } from '../xrechnungGenerator';
import { generateZUGFeRDXML } from '../zugferdGenerator';
import { calculateInvoiceWithDiscounts, updateItemWithDiscount } from '../../discountUtils';
import { Invoice, InvoiceItem } from '../../../types';
import { PDFOptions } from '../../pdfGenerator';
import { testItem, testOptions } from './fixtures';

/**
 * Beispiel-E-Rechnungen für den KoSIT-Validator (scripts/kosit-validate.sh).
 * Schreibt nur, wenn KOSIT_SAMPLES_OUT gesetzt ist; im normalen Testlauf übersprungen.
 * Summen wie beim Speichern im Backend (Cent-genau, documentTotals.js).
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const outDir = env.KOSIT_SAMPLES_OUT;

type GlobalDiscount = { type?: 'percentage' | 'fixed'; value?: number };

function invoiceOf(number: string, items: InvoiceItem[], discount: GlobalDiscount, isSmallBusiness = false): Invoice {
  const prepared = items.map(updateItemWithDiscount);
  const calc = calculateInvoiceWithDiscounts(prepared, discount, isSmallBusiness);
  return {
    id: number, invoiceNumber: number, customerId: 'cust-1', customerName: 'Kunde AG',
    issueDate: new Date('2026-03-10'), dueDate: new Date('2026-03-24'), items: prepared,
    subtotal: calc.subtotal, taxAmount: calc.taxAmount, total: calc.total,
    globalDiscountType: discount.type, globalDiscountValue: discount.value, globalDiscountAmount: calc.globalDiscountAmount,
    status: 'sent', createdAt: new Date('2026-03-10'),
  } as Invoice;
}

/** Wie backend/services/cancellationService.js: Mengen, Rabattbeträge, Summen negiert. */
function cancellationOf(original: Invoice, number: string): Invoice {
  const neg = (v: number | undefined) => (v === undefined ? v : -v);
  return {
    ...original,
    id: number, invoiceNumber: number, issueDate: new Date('2026-11-18'), dueDate: new Date('2026-11-18'),
    status: 'cancelled', invoiceType: 'cancellation', cancelsInvoiceId: original.id,
    cancelsInvoice: { id: original.id, invoiceNumber: original.invoiceNumber, issueDate: original.issueDate },
    cancellationReason: 'Falscher Leistungszeitraum',
    items: original.items.map(i => ({
      ...i, quantity: -i.quantity, total: -i.total, discountAmount: neg(i.discountAmount),
      discountValue: i.discountType === 'fixed' ? neg(i.discountValue) : i.discountValue,
    })),
    subtotal: -original.subtotal, taxAmount: -original.taxAmount, total: -original.total,
    globalDiscountAmount: neg(original.globalDiscountAmount),
    globalDiscountValue: original.globalDiscountType === 'fixed' ? neg(original.globalDiscountValue) : original.globalDiscountValue,
  };
}

const bank = { bankAccount: 'DE89370400440532013000', bic: 'COBADEFFXXX' };
const mixed = invoiceOf('RE-2026-001', [
  testItem({ id: 'a', description: 'Montage', quantity: 3, unitPrice: 33.33, taxRate: 19, discountType: 'fixed', discountValue: 10, order: 1 }),
  testItem({ id: 'b', description: 'Material', quantity: 2.5, unitPrice: 19.99, taxRate: 7, discountType: 'percentage', discountValue: 10, order: 2 }),
  testItem({ id: 'c', description: 'Anfahrt', quantity: 1, unitPrice: 25, taxRate: 19, order: 3 }),
], { type: 'percentage', value: 5 });

const SAMPLES: [string, Invoice, PDFOptions][] = [
  ['rechnung-gemischt', mixed, testOptions(bank)],
  ['storno-gemischt', cancellationOf(mixed, 'ST-2026-001'), testOptions(bank)],
  ['rechnung-19', invoiceOf('RE-2026-002', [testItem({ quantity: 7, unitPrice: 3.19, taxRate: 19 })], { type: 'fixed', value: 2.5 }), testOptions(bank)],
  ['rechnung-kleinunternehmer', invoiceOf('RE-2026-003', [testItem({ quantity: 2, unitPrice: 49.9, taxRate: 0 })], {}, true),
    testOptions({ ...bank, isSmallBusiness: true })],
  ['rechnung-reverse-charge', invoiceOf('RE-2026-004', [testItem({ quantity: 1.5, unitPrice: 80, taxRate: 0 })], {}),
    testOptions(bank, { taxId: 'ATU12345678', country: 'Österreich' })],
];

describe.skipIf(!outDir)('KoSIT-Beispiele schreiben', () => {
  it('schreibt UBL und CII je Beispiel', async () => {
    const fsModule = 'node:fs';
    const fs = await import(/* @vite-ignore */ fsModule) as { mkdirSync(p: string, o: object): void; writeFileSync(p: string, d: string): void };
    fs.mkdirSync(outDir!, { recursive: true });
    for (const [name, invoice, options] of SAMPLES) {
      fs.writeFileSync(`${outDir}/${name}.ubl.xml`, await (await generateXRechnungXML(invoice, { ...options, format: 'xrechnung' })).text());
      fs.writeFileSync(`${outDir}/${name}.cii.xml`, generateZUGFeRDXML(invoice, { ...options, format: 'zugferd' }));
    }
    expect(SAMPLES).toHaveLength(5);
  });
});
