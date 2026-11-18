import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import { generateInvoicePDF, generateQuotePDF, generateReminderPDF } from '../../pdfGenerator';
import { testInvoice, testItem, testOptions } from './fixtures';
import type { Invoice, Quote } from '../../../types';

const load = async (blob: Blob) => PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
const text = async (blob: Blob) => new TextDecoder('latin1').decode(await blob.arrayBuffer());

const xmpOf = (doc: PDFDocument): string | null => {
  const stream = doc.catalog.lookupMaybe(PDFName.of('Metadata'), PDFStream);
  return stream instanceof PDFRawStream ? new TextDecoder().decode(stream.getContents()) : null;
};

/** Alle Schriften müssen eingebettet sein: keine einfachen Type1-Standardschriften. */
const nonEmbeddedFonts = (doc: PDFDocument): string[] =>
  doc.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter((obj): obj is PDFDict => obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font'))
    .filter(font => font.get(PDFName.of('Subtype')) === PDFName.of('Type1'))
    .map(font => String(font.get(PDFName.of('BaseFont'))));

const invoice = (overrides: Partial<Invoice> = {}): Invoice =>
  testInvoice([testItem({ description: 'Prüfung Größe € 100' })], { status: 'sent', ...overrides });

const quote = (status: Quote['status']): Quote => ({
  ...testInvoice([testItem()]),
  quoteNumber: 'AN-2026-001',
  validUntil: '2026-12-31',
  status,
} as unknown as Quote);

const zugferd = { ...testOptions(), format: 'zugferd' as const };

describe('PDF/A-3b', () => {
  it('ZUGFeRD-Rechnung: XMP mit PDF/A-3B und Factur-X, OutputIntent, factur-x.xml mit /AF', async () => {
    const blob = await generateInvoicePDF(invoice(), zugferd);
    const doc = await load(blob);

    expect((await text(blob)).startsWith('%PDF-1.7')).toBe(true);
    const xmp = xmpOf(doc)!;
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');
    expect(xmp).toContain('<fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>');
    expect(xmp).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Rechnung RE-2026-001</rdf:li></rdf:Alt></dc:title>');
    expect(xmp).toContain('<xmp:CreateDate>2026-03-01T00:00:00Z</xmp:CreateDate>');

    const intents = doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray);
    const intent = intents.lookup(0, PDFDict);
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    expect(intent.lookup(PDFName.of('DestOutputProfile'))).toBeInstanceOf(PDFStream);

    expect(doc.catalog.lookup(PDFName.of('AF'), PDFArray).size()).toBe(1);
    expect(await text(blob)).toContain('factur-x.xml');
    expect(doc.getTitle()).toBe('Rechnung RE-2026-001');
    expect(doc.getProducer()).toBe('OpenBills');
    expect(doc.getCreator()).toBe('OpenBills');
    expect(nonEmbeddedFonts(doc)).toEqual([]);
  });

  it('Stornorechnung trägt den Titel „Stornorechnung“', async () => {
    const blob = await generateInvoicePDF(invoice({
      invoiceNumber: 'ST-2026-001', status: 'cancelled', invoiceType: 'cancellation',
      cancelsInvoice: { id: 'orig', invoiceNumber: 'RE-2026-001', issueDate: new Date('2026-02-01') },
      cancellationReason: 'Test',
    }), zugferd);
    expect((await load(blob)).getTitle()).toBe('Stornorechnung ST-2026-001');
  });

  it('Angebot und Mahnung sind PDF/A-3B ohne Factur-X', async () => {
    for (const blob of [
      await generateQuotePDF(quote('sent'), testOptions()),
      await generateReminderPDF(invoice({ status: 'overdue' }), 2, 'Bitte zahlen', 5, zugferd),
    ]) {
      const doc = await load(blob);
      const xmp = xmpOf(doc)!;
      expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
      expect(xmp).not.toContain('fx:');
      expect(doc.catalog.get(PDFName.of('OutputIntents'))).toBeDefined();
      expect(doc.catalog.get(PDFName.of('AF'))).toBeUndefined();
      expect(nonEmbeddedFonts(doc)).toEqual([]);
    }
  });

  it('Entwürfe sind kein PDF/A (Wasserzeichen), Schrift trotzdem eingebettet', async () => {
    for (const blob of [
      await generateInvoicePDF(invoice({ status: 'draft' }), zugferd),
      await generateQuotePDF(quote('draft'), testOptions()),
    ]) {
      const doc = await load(blob);
      expect(xmpOf(doc)).toBeNull();
      expect(nonEmbeddedFonts(doc)).toEqual([]);
    }
  });
});
