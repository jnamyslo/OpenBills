/**
 * Gibt einen Entwurf frei (Status 'sent'), bevor er versendet oder als fertiges Dokument
 * heruntergeladen wird. Die Freigabe zählt im Backend gegen das Plan-Kontingent und kann
 * dort mit HTTP 402 scheitern – dann wird nichts ausgegeben.
 *
 * Schlägt die Ausgabe nach der Freigabe fehl, wird der Status auf 'draft' zurückgesetzt.
 * Das Kontingent bleibt verbraucht, ein erneuter Versuch zählt aber nicht noch einmal.
 */
export async function releaseForOutput<T extends { status: string }, R>(
  doc: T,
  setStatus: (status: 'draft' | 'sent') => Promise<void>,
  output: (released: T) => Promise<R>
): Promise<R> {
  if (doc.status !== 'draft') return output(doc);

  await setStatus('sent');
  try {
    return await output({ ...doc, status: 'sent' });
  } catch (error) {
    await setStatus('draft').catch(() => undefined);
    throw error;
  }
}
