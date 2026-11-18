import { useState } from 'react';
import { Ban } from 'lucide-react';
import { Invoice } from '../types';
import { Modal } from './Modal';

const MAX_REASON_LENGTH = 500;

export type CancelMode = 'cancel' | 'recreate';

interface CancelInvoiceModalProps {
  invoice: Invoice;
  mode: CancelMode;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: (reason: string, releaseSources: boolean) => void;
}

/** Storno einer freigegebenen Rechnung (Spec Belegarchiv/Storno § 3). */
export function CancelInvoiceModal({ invoice, mode, isLoading, onClose, onConfirm }: CancelInvoiceModalProps) {
  const [reason, setReason] = useState('');
  const [releaseSources, setReleaseSources] = useState(true);
  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_REASON_LENGTH && !isLoading;

  return (
    <Modal
      title={mode === 'recreate' ? 'Stornieren und neu erstellen' : 'Rechnung stornieren'}
      onClose={onClose}
      closeDisabled={isLoading}
      icon={<div className="p-2 rounded-full bg-red-100"><Ban className="h-5 w-5 text-red-600" /></div>}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmed, releaseSources)}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-400"
          >
            {isLoading ? 'Wird storniert...' : mode === 'recreate' ? 'Stornieren und Entwurf öffnen' : 'Stornieren'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-gray-700">
        <p>
          Zur Rechnung <strong>{invoice.invoiceNumber}</strong> wird eine Stornorechnung mit negativen Beträgen erstellt.
          Beide Belege erhalten den Status „Storniert“. Das lässt sich nicht rückgängig machen.
        </p>
        {mode === 'recreate' && (
          <p>
            Danach wird ein neuer Entwurf mit dem Inhalt der Rechnung angelegt und geöffnet. Zugehörige Aufträge und
            das Angebot werden dem neuen Entwurf zugeordnet.
          </p>
        )}
        {invoice.status === 'paid' && (
          <p className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
            Diese Rechnung ist bereits bezahlt. Eine Erstattung an den Kunden erfolgt außerhalb von OpenBills.
          </p>
        )}
        <div>
          <label htmlFor="cancel-reason" className="block font-medium text-gray-900 mb-1">
            Stornogrund <span className="text-red-600">*</span>
          </label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            disabled={isLoading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="z. B. falscher Rechnungsempfänger"
          />
          <p className="text-xs text-gray-500 mt-1">
            Erscheint auf der Stornorechnung. {trimmed.length}/{MAX_REASON_LENGTH}
          </p>
        </div>
        {mode === 'cancel' && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={releaseSources}
              onChange={e => setReleaseSources(e.target.checked)}
              disabled={isLoading}
              className="custom-checkbox mt-0.5"
            />
            <span>Aufträge und Angebot wieder zur Abrechnung freigeben</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
