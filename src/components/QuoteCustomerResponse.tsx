import { useState } from 'react';
import { UserCheck, UserX } from 'lucide-react';
import type { QuoteCustomerResponse } from '../types';
import { Modal } from './Modal';

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

const isAccepted = (response: QuoteCustomerResponse) => response.decision === 'accepted';

function DecisionIcon({ response, className }: { response: QuoteCustomerResponse; className: string }) {
  return isAccepted(response)
    ? <UserCheck className={`${className} text-green-600`} />
    : <UserX className={`${className} text-red-600`} />;
}

/** Alle Angaben zur Kundenantwort per Mail-Link. */
function QuoteCustomerResponseDetails({ response }: { response: QuoteCustomerResponse }) {
  const safeTermsUrl = response.termsUrl && /^https?:\/\//i.test(response.termsUrl) ? response.termsUrl : null;
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-gray-500">Entscheidung</dt>
      <dd className={`font-medium ${isAccepted(response) ? 'text-green-700' : 'text-red-700'}`}>
        {isAccepted(response) ? 'Angenommen' : 'Abgelehnt'}
      </dd>
      <dt className="text-gray-500">Name</dt>
      <dd className="text-gray-900 break-words">{response.name}</dd>
      <dt className="text-gray-500">Zeitpunkt</dt>
      <dd className="text-gray-900">{formatDateTime(response.respondedAt)}</dd>
      <dt className="text-gray-500">{isAccepted(response) ? 'Anmerkung' : 'Grund'}</dt>
      <dd className="text-gray-900 whitespace-pre-wrap break-words">
        {response.comment || <span className="text-gray-400">–</span>}
      </dd>
      {isAccepted(response) && (
        <>
          <dt className="text-gray-500">AGB</dt>
          <dd className="text-gray-900 break-words">
            {safeTermsUrl ? (
              <>Bestätigt (<a href={safeTermsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{safeTermsUrl}</a>)</>
            ) : (
              <span className="text-gray-400">Keine AGB hinterlegt</span>
            )}
          </dd>
        </>
      )}
      <dt className="text-gray-500">Link gesendet an</dt>
      <dd className="text-gray-900 break-words">
        {response.recipients || <span className="text-gray-400">–</span>}
        <span className="block text-xs text-gray-500">am {formatDateTime(response.sentAt)}</span>
      </dd>
    </dl>
  );
}

/** Kleines Symbol neben dem Status in der Angebotsliste; Klick öffnet alle Details. */
export function QuoteCustomerResponseButton({ response }: { response?: QuoteCustomerResponse }) {
  const [open, setOpen] = useState(false);
  if (!response) return null;
  const label = `Per Link ${isAccepted(response) ? 'angenommen' : 'abgelehnt'} von ${response.name} – Details anzeigen`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-full p-1 transition-colors ${
          isAccepted(response) ? 'bg-green-50 hover:bg-green-100' : 'bg-red-50 hover:bg-red-100'
        }`}
      >
        <DecisionIcon response={response} className="h-4 w-4" />
      </button>
      {open && (
        <Modal
          title="Antwort des Kunden"
          icon={<DecisionIcon response={response} className="h-5 w-5" />}
          onClose={() => setOpen(false)}
        >
          <QuoteCustomerResponseDetails response={response} />
        </Modal>
      )}
    </>
  );
}

/** Kasten im Angebotseditor. */
export function QuoteCustomerResponsePanel({ response }: { response?: QuoteCustomerResponse }) {
  if (!response) return null;
  return (
    <div className={`rounded-lg border p-4 ${isAccepted(response) ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}`}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <DecisionIcon response={response} className="h-4 w-4" />
        Antwort des Kunden über den Link in der Angebotsmail
      </h3>
      <QuoteCustomerResponseDetails response={response} />
    </div>
  );
}
