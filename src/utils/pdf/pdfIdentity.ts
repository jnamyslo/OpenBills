import type jsPDF from 'jspdf';

/**
 * Reproduzierbare PDFs (Plan Belegarchiv, N6): Derselbe Beleg ergibt dieselbe Datei, damit das
 * Belegarchiv per SHA-256 dedupliziert. jsPDF/pdf-lib schreiben sonst die aktuelle Uhrzeit und
 * eine zufällige Datei-ID.
 */

/**
 * 128-Bit-Hash (cyrb128) als 32 Hex-Zeichen für den PDF-Trailer `/ID`.
 * Bewusst ohne `crypto.subtle` (fehlt ohne HTTPS, z. B. Self-Hosted per IP).
 */
export function pdfFileId(key: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < key.length; i++) {
    const k = key.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, '0')).join('').toUpperCase();
}

/** Belegdatum als Datum für die PDF-Metadaten (Rechnungs-/Angebotsdatum, nicht „jetzt“). */
export function documentDate(value: Date | string): Date {
  return new Date(value);
}

/** Heute 00:00 Ortszeit – für Belege, die das heutige Datum enthalten (Mahnungen). */
export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Feste Datei-ID und Erstelldatum für ein jsPDF-Dokument. */
export function applyPdfIdentity(pdf: jsPDF, key: string, date: Date): void {
  pdf.setFileId(pdfFileId(key));
  pdf.setCreationDate(date);
}
