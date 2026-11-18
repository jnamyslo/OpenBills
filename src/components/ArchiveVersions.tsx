import { useEffect, useState } from 'react';
import { Archive, Download } from 'lucide-react';
import { ArchiveEntry } from '../types';
import { apiService } from '../services/api';
import logger from '../utils/logger';

const FORMAT_LABELS: Record<ArchiveEntry['format'], string> = {
  pdf: 'PDF',
  zugferd: 'ZUGFeRD-PDF',
  xrechnung: 'XRechnung (XML)',
};

function label(entry: ArchiveEntry): string {
  if (entry.documentType === 'reminder') return `Mahnung Stufe ${entry.reminderStage}`;
  return FORMAT_LABELS[entry.format];
}

/** Archivierte Originalfassungen eines Belegs (bei Rechnungen inkl. Mahnungen). */
export function ArchiveVersions({ documentId }: { documentId: string }) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    apiService.getArchive({ documentId })
      .then(list => { if (active) setEntries(list); })
      .catch(err => {
        logger.error('Archivfassungen konnten nicht geladen werden', { error: String(err) });
        if (active) setError(true);
      });
    return () => { active = false; };
  }, [documentId]);

  return (
    <div>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
        <Archive className="h-4 w-4 text-gray-500" />
        Archivierte Fassungen
      </h4>
      {error && <p className="text-sm text-red-600">Archivfassungen konnten nicht geladen werden.</p>}
      {!error && entries === null && <p className="text-sm text-gray-500">Wird geladen...</p>}
      {entries?.length === 0 && (
        <p className="text-sm text-gray-500">
          Noch keine Fassung archiviert. Beim Herunterladen oder Versenden wird die ausgegebene Datei hier abgelegt.
        </p>
      )}
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {entries.map(entry => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{label(entry)}</p>
                <p className="text-xs text-gray-500">
                  {new Date(entry.createdAt).toLocaleString('de-DE')}
                  {entry.source === 'regenerated' ? ' · nachträglich erzeugt' : ''}
                  {' · '}{Math.max(1, Math.round(entry.size / 1024))} KB
                </p>
              </div>
              <a
                href={apiService.archiveDownloadUrl(entry.id)}
                download={entry.filename}
                className="flex-shrink-0 bg-green-100 hover:bg-green-200 text-green-700 p-1.5 rounded-md"
                title={`${entry.filename} herunterladen`}
              >
                <Download className="h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
