import { describe, it, expect, vi } from 'vitest';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { generateInvoicePDF, generateQuotePDF } from '../../pdfGenerator';
import { DraftExportError } from '../draftWatermark';
import { releaseForOutput } from '../../releaseForOutput';
import { testCompany, testCustomer, testInvoice, testItem, testOptions } from './fixtures';
import type { Invoice, Quote } from '../../../types';

const hasEmbeddedFiles = async (blob: Blob) => {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  return Boolean(doc.catalog.get(PDFName.of('AF')) || names?.get(PDFName.of('EmbeddedFiles')));
};

/** jsPDF schreibt Text unkomprimiert in den Content-Stream. */
const containsText = async (blob: Blob, text: string) =>
  new TextDecoder('latin1').decode(await blob.arrayBuffer()).includes(`(${text})`);

const invoice = (status: Invoice['status']): Invoice =>
  ({ ...testInvoice([testItem()]), status });

describe('Entwurfs-Wasserzeichen Rechnung', () => {
  it('Entwurf als XRechnung → DraftExportError', async () => {
    await expect(generateInvoicePDF(invoice('draft'), testOptions()))
      .rejects.toBeInstanceOf(DraftExportError);
  });

  it('Entwurf-PDF hat Wasserzeichen und kein eingebettetes ZUGFeRD-XML', async () => {
    const blob = await generateInvoicePDF(invoice('draft'), { ...testOptions(), format: 'zugferd' });
    expect(await containsText(blob, 'ENTWURF')).toBe(true);
    expect(await hasEmbeddedFiles(blob)).toBe(false);
  });

  it('freigegebene Rechnung: kein Wasserzeichen, ZUGFeRD eingebettet', async () => {
    const blob = await generateInvoicePDF(invoice('sent'), { ...testOptions(), format: 'zugferd' });
    expect(await containsText(blob, 'ENTWURF')).toBe(false);
    expect(await hasEmbeddedFiles(blob)).toBe(true);
  });
});

describe('Entwurfs-Wasserzeichen Angebot', () => {
  const quote = (status: Quote['status']) => ({
    ...testInvoice([testItem()]),
    quoteNumber: 'AN-2026-001',
    validUntil: '2026-12-31',
    status,
  }) as unknown as Quote;

  it('nur Entwürfe erhalten das Wasserzeichen', async () => {
    const options = { company: testCompany(), customer: testCustomer() };
    expect(await containsText(await generateQuotePDF(quote('draft'), options), 'ENTWURF')).toBe(true);
    expect(await containsText(await generateQuotePDF(quote('sent'), options), 'ENTWURF')).toBe(false);
  });
});

describe('releaseForOutput', () => {
  it('gibt Entwurf vor der Ausgabe frei und reicht freigegebenes Dokument weiter', async () => {
    const calls: string[] = [];
    const setStatus = vi.fn(async (s: string) => { calls.push(`status:${s}`); });
    const result = await releaseForOutput({ status: 'draft' }, setStatus, async doc => {
      calls.push(`output:${doc.status}`);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toEqual(['status:sent', 'output:sent']);
  });

  it('setzt bei Ausgabefehler auf Entwurf zurück und wirft weiter', async () => {
    const setStatus = vi.fn<(status: 'draft' | 'sent') => Promise<void>>(async () => undefined);
    await expect(releaseForOutput({ status: 'draft' }, setStatus, async () => { throw new Error('SMTP'); }))
      .rejects.toThrow('SMTP');
    expect(setStatus.mock.calls.map(c => c[0])).toEqual(['sent', 'draft']);
  });

  it('gibt nichts aus, wenn die Freigabe scheitert (z. B. 402)', async () => {
    const output = vi.fn();
    await expect(releaseForOutput({ status: 'draft' }, async () => { throw new Error('Limit'); }, output))
      .rejects.toThrow('Limit');
    expect(output).not.toHaveBeenCalled();
  });

  it('lässt bereits freigegebene Dokumente unverändert', async () => {
    const setStatus = vi.fn();
    await releaseForOutput({ status: 'paid' }, setStatus, async doc => expect(doc.status).toBe('paid'));
    expect(setStatus).not.toHaveBeenCalled();
  });
});
