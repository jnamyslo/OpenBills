import { describe, it, expect } from 'vitest';
import { generateXRechnungXML } from '../xrechnungGenerator';
import { generateZUGFeRDXML } from '../zugferdGenerator';
import { Invoice } from '../../../types';
import { testInvoice, testItem, testOptions, tag, tags } from './fixtures';

/**
 * Stornorechnung (Spec § 3): BT-3 = 384, BG-3 mit BT-25 + BT-26, Mengen negativ,
 * Einzelpreise positiv, alle Beträge = negierte Beträge der Originalrechnung.
 */

// Positionsrabatt (fest + Prozent), Gesamtrabatt, 7 % + 19 %
const original = (): Invoice =>
  testInvoice(
    [
      testItem({ id: 'a', description: 'Montage', quantity: 3, unitPrice: 33.33, taxRate: 19, discountType: 'fixed', discountValue: 10, discountAmount: 10, total: 89.99, order: 1 }),
      testItem({ id: 'b', description: 'Material', quantity: 2.5, unitPrice: 19.99, taxRate: 7, discountType: 'percentage', discountValue: 10, discountAmount: 5, total: 44.98, order: 2 }),
      testItem({ id: 'c', description: 'Anfahrt', quantity: 1, unitPrice: 25, taxRate: 19, total: 25, order: 3 }),
    ],
    {
      status: 'sent',
      issueDate: new Date('2026-03-10'),
      dueDate: new Date('2026-03-24'),
      globalDiscountType: 'percentage',
      globalDiscountValue: 5,
      globalDiscountAmount: 7.95,
      taxAmount: 30.22,
      total: 181.24,
    }
  );

/** Wie der Storno-Service im Backend: Mengen/Rabattbeträge/Summen negiert, Preise unverändert. */
const cancellationOf = (inv: Invoice): Invoice => ({
  ...inv,
  id: 'st-1',
  invoiceNumber: 'ST-2026-001',
  issueDate: new Date('2026-11-18'),
  dueDate: new Date('2026-11-18'),
  status: 'cancelled',
  invoiceType: 'cancellation',
  cancelsInvoiceId: inv.id,
  cancelsInvoice: { id: inv.id, invoiceNumber: inv.invoiceNumber, issueDate: inv.issueDate },
  cancellationReason: 'Falscher Leistungszeitraum',
  notes: undefined,
  items: inv.items.map((item) => ({
    ...item,
    quantity: -item.quantity,
    total: -item.total,
    discountAmount: item.discountAmount === undefined ? undefined : -item.discountAmount,
    discountValue: item.discountType === 'fixed' && item.discountValue !== undefined ? -item.discountValue : item.discountValue,
  })),
  subtotal: -inv.subtotal,
  taxAmount: -inv.taxAmount,
  total: -inv.total,
  globalDiscountAmount: inv.globalDiscountAmount === undefined ? undefined : -inv.globalDiscountAmount,
});

const values = (xml: string, names: string[]) => names.flatMap((n) => tags(xml, n));
const negated = (list: string[]) => list.map((v) => (Number(v) === 0 ? '0.00' : (-Number(v)).toFixed(2)));

describe('Stornorechnung XRechnung (UBL)', () => {
  const xml = async (inv: Invoice) => (await generateXRechnungXML(inv, testOptions())).text();
  const AMOUNTS = ['cbc:LineExtensionAmount', 'cbc:TaxExclusiveAmount', 'cbc:TaxInclusiveAmount', 'cbc:AllowanceTotalAmount',
    'cbc:PayableAmount', 'cbc:TaxAmount', 'cbc:TaxableAmount', 'cbc:Amount'];

  it('Typcode 384 und Bezug auf die Originalrechnung (BT-25/BT-26)', async () => {
    const out = await xml(cancellationOf(original()));
    expect(tag(out, 'cbc:InvoiceTypeCode')).toBe('384');
    const ref = tag(tag(out, 'cac:BillingReference') ?? '', 'cac:InvoiceDocumentReference') ?? '';
    expect(tag(ref, 'cbc:ID')).toBe('RE-2026-001');
    expect(tag(ref, 'cbc:IssueDate')).toBe('2026-03-10');
    // BillingReference steht im Schema vor AccountingSupplierParty
    expect(out.indexOf('<cac:BillingReference>')).toBeLessThan(out.indexOf('<cac:AccountingSupplierParty>'));
    expect(tag(out, 'cbc:Note')).toContain('Storno zur Rechnung RE-2026-001 vom 10.03.2026');
    expect(tag(out, 'cbc:Note')).toContain('Falscher Leistungszeitraum');
  });

  it('Mengen negativ, Einzelpreise positiv, alle Beträge exakt negiert', async () => {
    const orig = await xml(original());
    const out = await xml(cancellationOf(original()));
    expect(tags(out, 'cbc:InvoicedQuantity')).toEqual(['-3.00', '-2.50', '-1.00']);
    expect(tags(out, 'cbc:PriceAmount')).toEqual(tags(orig, 'cbc:PriceAmount'));
    expect(tags(out, 'cbc:PriceAmount').every((p) => Number(p) > 0)).toBe(true);
    expect(values(out, AMOUNTS)).toEqual(negated(values(orig, AMOUNTS)));
    expect(Number(tag(out, 'cbc:PayableAmount'))).toBeLessThan(0);
  });

  it('normale Rechnung bleibt 380 ohne Bezug', async () => {
    const out = await xml(original());
    expect(tag(out, 'cbc:InvoiceTypeCode')).toBe('380');
    expect(out).not.toContain('BillingReference');
  });

  it('verweigert Stornorechnung ohne Originaldaten', async () => {
    const inv = { ...cancellationOf(original()), cancelsInvoice: null };
    await expect(generateXRechnungXML(inv, testOptions())).rejects.toThrow(/Originalrechnung/);
  });
});

describe('Stornorechnung ZUGFeRD (CII)', () => {
  const AMOUNTS = ['ram:LineTotalAmount', 'ram:ActualAmount', 'ram:CalculatedAmount', 'ram:BasisAmount', 'ram:AllowanceTotalAmount',
    'ram:TaxBasisTotalAmount', 'ram:TaxTotalAmount', 'ram:GrandTotalAmount', 'ram:DuePayableAmount'];

  it('Typcode 384 und InvoiceReferencedDocument mit Nummer und Datum', () => {
    const out = generateZUGFeRDXML(cancellationOf(original()), testOptions());
    expect(tag(tags(out, 'rsm:ExchangedDocument')[0], 'ram:TypeCode')).toBe('384');
    const ref = tag(out, 'ram:InvoiceReferencedDocument') ?? '';
    expect(tag(ref, 'ram:IssuerAssignedID')).toBe('RE-2026-001');
    expect(tag(ref, 'qdt:DateTimeString')).toBe('20260310');
    // CII-Reihenfolge: nach der Summenzeile in ApplicableHeaderTradeSettlement
    expect(out.indexOf('<ram:InvoiceReferencedDocument>')).toBeGreaterThan(out.indexOf('</ram:SpecifiedTradeSettlementHeaderMonetarySummation>'));
    expect(out.indexOf('<ram:InvoiceReferencedDocument>')).toBeLessThan(out.indexOf('</ram:ApplicableHeaderTradeSettlement>'));
    expect(tag(out, 'ram:IncludedNote')).toContain('Storno zur Rechnung RE-2026-001 vom 10.03.2026');
  });

  it('Mengen negativ, Einzelpreise positiv, alle Beträge exakt negiert', () => {
    const orig = generateZUGFeRDXML(original(), testOptions());
    const out = generateZUGFeRDXML(cancellationOf(original()), testOptions());
    expect(tags(out, 'ram:BilledQuantity')).toEqual(['-3', '-2.5', '-1']);
    expect(tags(out, 'ram:ChargeAmount')).toEqual(tags(orig, 'ram:ChargeAmount'));
    expect(values(out, AMOUNTS)).toEqual(negated(values(orig, AMOUNTS)));
    expect(Number(tag(out, 'ram:GrandTotalAmount'))).toBeCloseTo(-181.24, 2);
  });

  it('normale Rechnung bleibt 380 ohne Bezug', () => {
    const out = generateZUGFeRDXML(original(), testOptions());
    expect(tag(tags(out, 'rsm:ExchangedDocument')[0], 'ram:TypeCode')).toBe('380');
    expect(out).not.toContain('InvoiceReferencedDocument');
  });
});
