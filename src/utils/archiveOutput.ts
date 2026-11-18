import { apiService } from '../services/api';
import { ArchiveDocumentType, ArchiveFormat, ArchiveSource } from '../types';
import { blobToBase64 } from './blobUtils';
import { downloadBlob } from './pdfGenerator';

interface ArchivableDocument {
  id: string;
  status: string;
}

/**
 * Legt eine ausgegebene Datei als Originalfassung im Belegarchiv ab.
 * Entwürfe (Wasserzeichen) werden nie archiviert → `false`.
 * Fehler werden geworfen: ohne Archiv kein Nachweis der Ausgabe.
 */
export async function archiveOutput(
  doc: ArchivableDocument,
  documentType: ArchiveDocumentType,
  format: ArchiveFormat,
  blob: Blob,
  filename: string,
  reminderStage?: 1 | 2 | 3,
  source: ArchiveSource = 'output'
): Promise<boolean> {
  if (doc.status === 'draft') return false;
  await apiService.archiveDocument({
    documentType,
    documentId: doc.id,
    format,
    filename,
    content: await blobToBase64(blob),
    source,
    reminderStage,
  });
  return true;
}

/**
 * Archiviert (außer bei Entwürfen) und startet danach den Browser-Download.
 * Scheitert das Archivieren, gibt es keinen Download; innerhalb von `releaseForOutput`
 * wird die Freigabe dann zurückgesetzt.
 */
export async function archiveAndDownload(
  doc: ArchivableDocument,
  documentType: ArchiveDocumentType,
  format: ArchiveFormat,
  blob: Blob,
  filename: string,
  reminderStage?: 1 | 2 | 3
): Promise<void> {
  await archiveOutput(doc, documentType, format, blob, filename, reminderStage);
  downloadBlob(blob, filename);
}

/**
 * Zusatz zur Erfolgsmeldung beim Mailversand, wenn das Backend versendete Belege nicht
 * archivieren konnte (`archived: false`). Leer, wenn alles archiviert wurde.
 */
export function notArchivedNote(count: number): string {
  if (count <= 0) return '';
  const what = count === 1 ? 'Der Beleg wurde' : `${count} Belege wurden`;
  return `\n\n⚠️ Versendet, aber nicht archiviert: ${what} nicht im Belegarchiv abgelegt. Bitte erneut herunterladen, damit die Originalfassung archiviert wird.`;
}
