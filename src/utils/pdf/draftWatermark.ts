/**
 * Wasserzeichen "ENTWURF" für Rechnungs- und Angebotsentwürfe.
 * Entwürfe zählen nicht gegen das Plan-Kontingent und dürfen deshalb nie
 * wie ein fertiges Dokument aussehen.
 */
import jsPDF, { GState } from 'jspdf';

export const DRAFT_WATERMARK_TEXT = 'ENTWURF';

/** Fehler, wenn ein Entwurf in ein Format exportiert werden soll, das kein Wasserzeichen tragen kann. */
export class DraftExportError extends Error {
  constructor(message = 'Entwürfe können nicht als XRechnung exportiert werden. Bitte die Rechnung zuerst freigeben.') {
    super(message);
    this.name = 'DraftExportError';
  }
}

/** Zeichnet ein diagonales, halbtransparentes "ENTWURF" auf jede Seite. */
export function addDraftWatermark(pdf: jsPDF): void {
  const pageCount = pdf.getNumberOfPages();
  const angle = 45;
  const rad = (angle * Math.PI) / 180;

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    pdf.setPage(pageNum);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    pdf.saveGraphicsState();
    pdf.setGState(new GState({ opacity: 0.15 }));
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(90);
    pdf.setTextColor(120, 120, 120);

    // Text um die Seitenmitte zentrieren (jsPDF dreht um den Startpunkt, y wächst nach unten)
    const textWidth = pdf.getTextWidth(DRAFT_WATERMARK_TEXT);
    const x = pageWidth / 2 - (textWidth / 2) * Math.cos(rad);
    const y = pageHeight / 2 + (textWidth / 2) * Math.sin(rad);
    pdf.text(DRAFT_WATERMARK_TEXT, x, y, { angle });

    pdf.restoreGraphicsState();
  }
}
