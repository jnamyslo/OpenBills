/**
 * Serverseitiges Wasserzeichen für Entwürfe.
 * Absicherung für den E-Mail-Versand: Ein Entwurf verlässt OpenBills nie als fertiges Dokument,
 * auch wenn das Frontend umgangen wird. Eingebettete Dateien (ZUGFeRD-XML) werden entfernt.
 */
import { PDFDocument, PDFDict, PDFName, StandardFonts, rgb, degrees } from 'pdf-lib';

export const DRAFT_WATERMARK_TEXT = 'ENTWURF';

/**
 * @param {Buffer|Uint8Array} pdfBytes
 * @returns {Promise<Buffer>} PDF mit Wasserzeichen auf jeder Seite, ohne eingebettete Dateien
 */
export async function stampDraftWatermark(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });

  // ZUGFeRD-Anhang entfernen: das eingebettete XML wäre eine vollwertige E-Rechnung
  doc.catalog.delete(PDFName.of('AF'));
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  names?.delete(PDFName.of('EmbeddedFiles'));

  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 90;
  const textWidth = font.widthOfTextAtSize(DRAFT_WATERMARK_TEXT, size);
  const rad = Math.PI / 4;

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(DRAFT_WATERMARK_TEXT, {
      x: width / 2 - (textWidth / 2) * Math.cos(rad),
      y: height / 2 - (textWidth / 2) * Math.sin(rad),
      size,
      font,
      color: rgb(0.47, 0.47, 0.47),
      opacity: 0.15,
      rotate: degrees(45),
    });
  }

  return Buffer.from(await doc.save());
}

/** true, wenn das PDF eingebettete Dateien hat (z. B. ZUGFeRD-XML). */
export async function hasEmbeddedFiles(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  return Boolean(doc.catalog.get(PDFName.of('AF')) || names?.get(PDFName.of('EmbeddedFiles')));
}
