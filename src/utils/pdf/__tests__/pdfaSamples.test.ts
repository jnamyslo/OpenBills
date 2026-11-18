import { describe, it, expect } from 'vitest';
import { generateInvoicePDF, generateQuotePDF, generateReminderPDF } from '../../pdfGenerator';
import { Invoice, Quote } from '../../../types';
import { testInvoice, testItem, testOptions } from './fixtures';

/**
 * Beispiel-PDFs für veraPDF/Mustang (scripts/pdfa-validate.sh).
 * Schreibt nur, wenn PDFA_SAMPLES_OUT gesetzt ist; im normalen Testlauf übersprungen.
 * Dateien `*-zugferd.pdf` prüft Mustang zusätzlich als ZUGFeRD/Factur-X.
 * Logos lassen sich hier nicht prüfen (Logo-Code braucht das Browser-`Image`) – manuell im Browser.
 */

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const outDir = env.PDFA_SAMPLES_OUT;

const bank = { bankAccount: 'DE89370400440532013000', bic: 'COBADEFFXXX' };

const items = [
  testItem({ id: 'a', description: 'Montage Größe XL – Prüfung', quantity: 3, unitPrice: 33.33, taxRate: 19, total: 99.99, order: 1 }),
  testItem({ id: 'b', description: 'Material', quantity: 2, unitPrice: 20, taxRate: 7, total: 40, order: 2 }),
];
const invoice = testInvoice(items, { id: 'b5e2f0a4-1c3d-4e5f-9a7b-2c3d4e5f6a7b', status: 'sent', taxAmount: 21.8, total: 161.79, subtotal: 139.99 });
const cancellation: Invoice = {
  ...invoice,
  id: 'c6f3a1b5-2d4e-4f6a-8b9c-3d4e5f6a7b8c', invoiceNumber: 'ST-2026-001', status: 'cancelled', invoiceType: 'cancellation',
  issueDate: new Date('2026-11-18'), dueDate: new Date('2026-11-18'),
  cancelsInvoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, issueDate: invoice.issueDate },
  cancellationReason: 'Falscher Leistungszeitraum',
  items: items.map(i => ({ ...i, quantity: -i.quantity, total: -i.total })),
  subtotal: -invoice.subtotal, taxAmount: -invoice.taxAmount, total: -invoice.total,
};
const quote = { ...invoice, quoteNumber: 'AN-2026-001', validUntil: '2026-12-31', status: 'sent' } as unknown as Quote;

describe.skipIf(!outDir)('PDF/A-Beispiele schreiben', () => {
  it('schreibt Rechnung, Storno, Angebot und Mahnung', async () => {
    const { writeFile } = await import('node:fs/promises');
    const zugferd = { ...testOptions(bank), format: 'zugferd' as const };
    const samples: [string, Blob][] = [
      ['rechnung-zugferd.pdf', await generateInvoicePDF(invoice, zugferd)],
      ['storno-zugferd.pdf', await generateInvoicePDF(cancellation, zugferd)],
      ['angebot.pdf', await generateQuotePDF(quote, zugferd)],
      ['mahnung-2.pdf', await generateReminderPDF({ ...invoice, status: 'overdue' }, 2, 'Bitte begleichen Sie den offenen Betrag.', 5, zugferd)],
    ];
    for (const [name, blob] of samples) {
      await writeFile(`${outDir}/${name}`, new Uint8Array(await blob.arrayBuffer()));
    }
    expect(samples).toHaveLength(4);
  });
});
