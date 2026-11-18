import { Ban, Download, FilePlus, Lock } from 'lucide-react';
import { Invoice } from '../types';
import { formatCurrency } from '../utils/formatters';
import { isCancellable } from '../utils/invoiceStatus';
import { Modal } from './Modal';
import { ArchiveVersions } from './ArchiveVersions';
import type { CancelMode } from './CancelInvoiceModal';

interface InvoiceDetailsModalProps {
  invoice: Invoice;
  locale: string;
  statusLabel: string;
  onClose: () => void;
  onDownload: (invoice: Invoice) => void;
  onCancel: (invoice: Invoice, mode: CancelMode) => void;
}

const formatDate = (date: Date | string) => new Date(date).toLocaleDateString('de-DE');

/** Detailansicht gesperrter (freigegebener) Rechnungen – statt des Editors. */
export function InvoiceDetailsModal({ invoice, locale, statusLabel, onClose, onDownload, onCancel }: InvoiceDetailsModalProps) {
  const cancellable = isCancellable(invoice);
  const isCancellation = invoice.invoiceType === 'cancellation';

  return (
    <Modal
      title={`${isCancellation ? 'Stornorechnung' : 'Rechnung'} ${invoice.invoiceNumber}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            Schließen
          </button>
          <button
            type="button"
            onClick={() => onDownload(invoice)}
            className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-2"
          >
            <Download className="h-4 w-4" /> Herunterladen
          </button>
          {cancellable && (
            <>
              <button
                type="button"
                onClick={() => onCancel(invoice, 'recreate')}
                className="px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 flex items-center justify-center gap-2"
              >
                <FilePlus className="h-4 w-4" /> Stornieren und neu erstellen
              </button>
              <button
                type="button"
                onClick={() => onCancel(invoice, 'cancel')}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center justify-center gap-2"
              >
                <Ban className="h-4 w-4" /> Stornieren
              </button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <p className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-700">
          <Lock className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-500" />
          {invoice.status === 'cancelled'
            ? 'Dieser Beleg ist storniert und kann nicht mehr geändert werden.'
            : 'Freigegebene Rechnungen können nicht mehr bearbeitet oder gelöscht werden. Korrekturen erfolgen über eine Stornorechnung.'}
        </p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <dt className="text-gray-500">Kunde</dt>
          <dd className="text-gray-900">{invoice.customerName}</dd>
          <dt className="text-gray-500">Rechnungsdatum</dt>
          <dd className="text-gray-900">{formatDate(invoice.issueDate)}</dd>
          {!isCancellation && (
            <>
              <dt className="text-gray-500">Fällig am</dt>
              <dd className="text-gray-900">{formatDate(invoice.dueDate)}</dd>
            </>
          )}
          <dt className="text-gray-500">Betrag</dt>
          <dd className="text-gray-900">{formatCurrency(invoice.total, locale)}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd className="text-gray-900">{statusLabel}</dd>
          {invoice.cancelsInvoice && (
            <>
              <dt className="text-gray-500">Storno zu</dt>
              <dd className="text-gray-900">
                {invoice.cancelsInvoice.invoiceNumber} vom {formatDate(invoice.cancelsInvoice.issueDate)}
              </dd>
            </>
          )}
          {invoice.cancelledByInvoice && (
            <>
              <dt className="text-gray-500">Storniert durch</dt>
              <dd className="text-gray-900">{invoice.cancelledByInvoice.invoiceNumber}</dd>
            </>
          )}
          {invoice.cancellationReason && (
            <>
              <dt className="text-gray-500">Stornogrund</dt>
              <dd className="text-gray-900 whitespace-pre-line">{invoice.cancellationReason}</dd>
            </>
          )}
        </dl>

        <ArchiveVersions documentId={invoice.id} />
      </div>
    </Modal>
  );
}
