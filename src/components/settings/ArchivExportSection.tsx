import { useCallback, useEffect, useState } from 'react';
import { Archive, Download, RefreshCw } from 'lucide-react';
import { apiService } from '../../services/api';
import { useCompany } from '../../context/CompanyContext';
import { archiveOutput } from '../../utils/archiveOutput';
import { generateInvoicePDF, generateQuotePDF } from '../../utils/pdfGenerator';
import logger from '../../utils/logger';

interface Missing {
  invoices: string[];
  quotes: string[];
}

/**
 * Archiv-Export (alle Tarife): ZIP mit allen archivierten Fassungen, Kunden und Rechnungsjournal.
 * Altbelege ohne Archivfassung lassen sich vorher nachträglich erzeugen (`source: 'regenerated'`).
 */
export function ArchivExportSection() {
  const { company } = useCompany();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [missing, setMissing] = useState<Missing | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMissing = useCallback(async () => {
    try {
      setMissing(await apiService.getArchiveMissing());
    } catch (err) {
      logger.error('Fehlende Archivfassungen konnten nicht geladen werden', { error: String(err) });
      setError('Fehlende Fassungen konnten nicht ermittelt werden.');
    }
  }, []);

  useEffect(() => { void loadMissing(); }, [loadMissing]);

  const missingCount = missing ? missing.invoices.length + missing.quotes.length : 0;
  const isGenerating = progress !== null && progress.done < progress.total;

  const generateMissing = async () => {
    if (!missing) return;
    setError(null);
    const total = missingCount;
    let done = 0;
    let failed = 0;
    setProgress({ done, total, failed });

    const step = async (work: () => Promise<void>, id: string) => {
      try {
        await work();
      } catch (err) {
        failed++;
        logger.error('Archivfassung konnte nicht erzeugt werden', { id, error: String(err) });
      }
      done++;
      setProgress({ done, total, failed });
    };

    for (const id of missing.invoices) {
      await step(async () => {
        const invoice = await apiService.getInvoice(id);
        const customer = await apiService.getCustomer(invoice.customerId);
        const blob = await generateInvoicePDF(invoice, { format: 'zugferd', company, customer });
        await archiveOutput(invoice, 'invoice', 'zugferd', blob, `${invoice.invoiceNumber}.pdf`, undefined, 'regenerated');
      }, id);
    }
    for (const id of missing.quotes) {
      await step(async () => {
        const quote = await apiService.getQuote(id);
        const customer = await apiService.getCustomer(quote.customerId);
        const blob = await generateQuotePDF(quote, { company, customer });
        await archiveOutput(quote, 'quote', 'pdf', blob, `${quote.quoteNumber}.pdf`, undefined, 'regenerated');
      }, id);
    }
    if (failed > 0) setError(`${failed} Fassung(en) konnten nicht erzeugt werden. Details im Browser-Log.`);
    await loadMissing();
  };

  const exportArchive = async () => {
    if (from && to && from > to) {
      setError('Das Startdatum liegt nach dem Enddatum.');
      return;
    }
    setError(null);
    setIsExporting(true);
    try {
      await apiService.downloadArchiveExport({ from: from || undefined, to: to || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Archiv-Export');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div id="archiv-export" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Archive className="h-5 w-5 text-gray-500" />
          Archiv exportieren
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Lädt alle archivierten Rechnungen, Stornorechnungen, Angebote und Mahnungen als ZIP herunter, dazu Anhänge,
          Kundenliste und Rechnungsjournal (CSV für Excel). Die Dateien lassen sich ohne OpenBills öffnen und dienen der
          gesetzlichen Aufbewahrung.
        </p>
      </div>

      {missing && missingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 space-y-2">
          <p>
            {missing.invoices.length} Rechnung(en) und {missing.quotes.length} Angebot(e) wurden vor Einführung des
            Archivs ausgegeben und haben noch keine Archivfassung. Sie können sie jetzt nachträglich erzeugen. Diese
            Fassungen nutzen die aktuellen Kunden- und Firmendaten und sind im Export als „nachträglich erzeugt“ gekennzeichnet.
          </p>
          <button
            type="button"
            onClick={generateMissing}
            disabled={isGenerating || isExporting}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:bg-gray-400"
          >
            <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating && progress ? `Erzeuge ${progress.done + 1} von ${progress.total} …` : 'Fehlende Fassungen erzeugen'}
          </button>
        </div>
      )}
      {missing && missingCount === 0 && (
        <p className="text-sm text-green-700">Alle freigegebenen Belege haben eine Archivfassung.</p>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <label className="text-sm text-gray-700">
          <span className="block mb-1">Belegdatum von (optional)</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
        </label>
        <label className="text-sm text-gray-700">
          <span className="block mb-1">bis (optional)</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
        </label>
        <button
          type="button"
          onClick={exportArchive}
          disabled={isExporting || isGenerating}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400"
        >
          <Download className="h-4 w-4" />
          {isExporting ? 'Wird erstellt …' : 'Archiv herunterladen'}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
