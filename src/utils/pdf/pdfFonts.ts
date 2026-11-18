import jsPDF from 'jspdf';

/**
 * Eingebettete Schrift für alle PDFs (PDF/A verlangt eingebettete Schriften; Helvetica ist eine
 * nicht eingebettete Standardschrift und darf nicht mitgeliefert werden). Liberation Sans hat die
 * Zeichenbreiten von Helvetica/Arial, Layout und Umbrüche bleiben gleich. Lizenz: SIL OFL 1.1,
 * src/assets/fonts/LICENSE-LiberationFonts.txt. jsPDF bettet nur die benutzten Glyphen ein.
 */
export const PDF_FONT = 'LiberationSans';

interface FontData {
  regular: string;
  bold: string;
}

let fontData: Promise<FontData> | null = null;

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

/** Lädt die Schriftdateien einmalig nach (eigener Chunk, nur beim Erzeugen von PDFs). */
function loadFontData(): Promise<FontData> {
  fontData ??= Promise.all([
    import('../../assets/fonts/LiberationSans-Regular.ttf?inline'),
    import('../../assets/fonts/LiberationSans-Bold.ttf?inline'),
  ]).then(([regular, bold]) => ({ regular: base64Of(regular.default), bold: base64Of(bold.default) }))
    .catch(error => {
      fontData = null;
      throw error;
    });
  return fontData;
}

/** Registriert die Schrift im Dokument und setzt sie als aktuelle Schrift. */
export async function registerPdfFonts(pdf: jsPDF): Promise<void> {
  const { regular, bold } = await loadFontData();
  pdf.addFileToVFS('LiberationSans-Regular.ttf', regular);
  pdf.addFont('LiberationSans-Regular.ttf', PDF_FONT, 'normal');
  pdf.addFileToVFS('LiberationSans-Bold.ttf', bold);
  pdf.addFont('LiberationSans-Bold.ttf', PDF_FONT, 'bold');
  pdf.setFont(PDF_FONT, 'normal');
}

/**
 * Neues A4-Dokument mit eingebetteter Schrift; nur benutzte Schriften werden geschrieben.
 * `compress`: Streams (v. a. die Schrift) per Deflate – sonst ca. 140 KB statt ca. 30 KB je PDF.
 */
export async function createPdfDocument(): Promise<jsPDF> {
  const pdf = new jsPDF({ putOnlyUsedFonts: true, compress: true });
  await registerPdfFonts(pdf);
  return pdf;
}
