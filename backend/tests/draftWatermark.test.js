import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { stampDraftWatermark, hasEmbeddedFiles } from '../utils/draftWatermark.js';

const pdfWithAttachment = async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  await doc.attach(Buffer.from('<rsm:CrossIndustryInvoice/>'), 'factur-x.xml', { mimeType: 'text/xml' });
  return Buffer.from(await doc.save());
};

describe('stampDraftWatermark', () => {
  it('entfernt eingebettetes ZUGFeRD-XML', async () => {
    const original = await pdfWithAttachment();
    expect(await hasEmbeddedFiles(original)).toBe(true);

    const stamped = await stampDraftWatermark(original);
    expect(await hasEmbeddedFiles(stamped)).toBe(false);
  });

  it('behält alle Seiten und bleibt ladbares PDF', async () => {
    const stamped = await stampDraftWatermark(await pdfWithAttachment());
    const reloaded = await PDFDocument.load(stamped);
    expect(reloaded.getPageCount()).toBe(2);
    expect(stamped.length).toBeGreaterThan(0);
  });
});
