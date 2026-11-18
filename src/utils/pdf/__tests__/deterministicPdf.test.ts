import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generateInvoicePDF, generateQuotePDF, generateReminderPDF } from '../../pdfGenerator';
import { testInvoice, testItem, testOptions } from './fixtures';
import type { Invoice, Quote } from '../../../types';

// N6: Gleicher Beleg → gleiche Datei, damit das Belegarchiv per SHA-256 dedupliziert.

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const at = (iso: string) => vi.setSystemTime(new Date(iso));

const invoice = (overrides: Partial<Invoice> = {}): Invoice =>
  testInvoice([testItem()], { id: '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b', status: 'sent', ...overrides });

const quote = (): Quote => ({
  ...testInvoice([testItem()]),
  quoteNumber: 'AN-2026-001',
  validUntil: '2026-12-31',
  status: 'sent',
} as unknown as Quote);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reproduzierbare PDFs', () => {
  it('ZUGFeRD-Rechnung ist zu jedem Zeitpunkt byte-identisch', async () => {
    const options = { ...testOptions(), format: 'zugferd' as const };
    at('2026-11-18T09:00:00Z');
    const first = await bytes(await generateInvoicePDF(invoice(), options));
    at('2026-12-24T17:30:00Z');
    const second = await bytes(await generateInvoicePDF(invoice(), options));
    expect(second).toEqual(first);
  });

  it('setzt Erstell- und Änderungsdatum auf das Rechnungsdatum', async () => {
    at('2026-11-18T09:00:00Z');
    const blob = await generateInvoicePDF(invoice(), { ...testOptions(), format: 'zugferd' });
    const doc = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(doc.getModificationDate()?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(doc.getProducer()).toBe('OpenBills');
  });

  it('verschiedene Rechnungen erhalten verschiedene Datei-IDs', async () => {
    const options = { ...testOptions(), format: 'zugferd' as const };
    const text = async (inv: Invoice) => new TextDecoder('latin1').decode(await bytes(await generateInvoicePDF(inv, options)));
    const idOf = (pdf: string) => pdf.match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/)?.[1];
    const a = idOf(await text(invoice()));
    const b = idOf(await text(invoice({ id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' })));
    expect(a).toMatch(/^[0-9A-F]{32}$/);
    expect(b).toMatch(/^[0-9A-F]{32}$/);
    expect(a).not.toBe(b);
  });

  it('Angebot ist zu jedem Zeitpunkt byte-identisch', async () => {
    const options = testOptions();
    at('2026-11-18T09:00:00Z');
    const first = await bytes(await generateQuotePDF(quote(), options));
    at('2027-01-05T08:00:00Z');
    expect(await bytes(await generateQuotePDF(quote(), options))).toEqual(first);
  });

  it('Mahnung ist am selben Tag byte-identisch (Mahndatum = heute)', async () => {
    const options = { ...testOptions(), format: 'zugferd' as const };
    at('2026-11-18T07:00:00Z');
    const first = await bytes(await generateReminderPDF(invoice({ status: 'overdue' }), 1, 'Bitte zahlen', 5, options));
    at('2026-11-18T15:00:00Z');
    const second = await bytes(await generateReminderPDF(invoice({ status: 'overdue' }), 1, 'Bitte zahlen', 5, options));
    expect(second).toEqual(first);
  });
});
