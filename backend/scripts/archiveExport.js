// Archiv-Export für Betreiber (z. B. vor dem Löschen einer Instanz), Aufruf über manage-instances.sh archive-export.
// Gleiches ZIP wie GET /api/archive/export. Fehlende Fassungen lassen sich nur in der App erzeugen; das Skript meldet sie.
//
//   node scripts/archiveExport.js [--out <datei>] [--from JJJJ-MM-TT] [--to JJJJ-MM-TT]
//
// Ohne --out geht das ZIP nach stdout; Meldungen immer nach stderr.

import fs from 'fs/promises';
import { pathToFileURL } from 'url';
import { pool } from '../database.js';
import { audit } from '../auth/audit.js';
import { buildArchiveZip } from '../services/archiveExportService.js';
import { countMissing } from '../services/archiveService.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const key = { '--out': 'out', '--from': 'from', '--to': 'to' }[flag];
    const value = argv[i + 1];
    if (!key || value === undefined) throw new Error(`Unbekannter oder unvollständiger Parameter: ${flag}`);
    if (key !== 'out' && (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value)))) {
      throw new Error(`Ungültiges Datum für ${flag} (Format JJJJ-MM-TT): ${value}`);
    }
    options[key] = value;
    i++;
  }
  return options;
}

/** Baut das Archiv-ZIP und liefert es mit der Anzahl freigegebener Belege ohne Archivfassung. */
export async function exportArchive({ from, to } = {}) {
  const [zip, missing] = await Promise.all([buildArchiveZip({ from, to }), countMissing()]);
  await audit(null, {
    action: 'archive.exported',
    entityType: 'archive',
    entityId: null,
    details: { from: from ?? null, to: to ?? null, size: zip.length, source: 'script' },
  });
  return { zip, missing: { invoices: missing.invoices.length, quotes: missing.quotes.length } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // stdout trägt das ZIP: alle Konsolenausgaben (auch Logger) nach stderr
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  try {
    const { out, from, to } = parseArgs(process.argv.slice(2));
    const { zip, missing } = await exportArchive({ from, to });
    if (out) await fs.writeFile(out, zip);
    else await new Promise((resolve, reject) => process.stdout.write(zip, (err) => (err ? reject(err) : resolve())));
    console.error(`Archiv-Export: ${zip.length} Bytes${out ? ` nach ${out}` : ''}.`);
    const total = missing.invoices + missing.quotes;
    if (total > 0) {
      console.error(
        `Hinweis: ${total} freigegebene Belege ohne Archivfassung (${missing.invoices} Rechnungen, ${missing.quotes} Angebote). ` +
          'Diese fehlen im Export. Erzeugen lassen sie sich nur in der App: Einstellungen → Backup & Archiv → „Fehlende Fassungen erzeugen“.'
      );
    }
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
