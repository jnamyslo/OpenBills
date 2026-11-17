import { FormEvent, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { QuoteDecision, QuoteResponseStatus, QuoteResponseView } from '../types';
import { errorMessage } from '../utils/authRoutes';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { AuthField, AuthLayout, AuthLoading, AuthMessage, AuthSubmitButton } from './AuthLayout';

interface QuoteResponsePageProps {
  token: string;
  decision?: QuoteDecision;
}

const STATUS_MESSAGES: Record<Exclude<QuoteResponseStatus, 'valid' | 'answered'>, string> = {
  invalid: 'Dieser Link ist ungültig.',
  closed: 'Zu diesem Angebot ist keine Antwort mehr möglich. Bitte wenden Sie sich direkt an uns.',
  expired: 'Das Angebot ist nicht mehr gültig. Bitte wenden Sie sich direkt an uns.',
  changed: 'Das Angebot wurde inzwischen geändert. Bitte verwenden Sie den Link aus der aktuellen Angebots-E-Mail.',
};

const DECISION_TEXT: Record<QuoteDecision, string> = {
  accepted: 'angenommen',
  rejected: 'abgelehnt',
};

const formatDate = (value?: string) => (value ? new Date(value).toLocaleDateString('de-DE') : '');

/** Öffentliche Seite aus der Angebotsmail: Kunde nimmt das Angebot an oder lehnt es ab (ohne Login). */
export function QuoteResponsePage({ token, decision: initialDecision }: QuoteResponsePageProps) {
  const [view, setView] = useState<QuoteResponseView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decision, setDecision] = useState<QuoteDecision>(initialDecision ?? 'accepted');
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiService.getQuoteResponse(token)
      .then((res) => active && setView(res))
      .catch((err) => active && setLoadError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [token]);

  const termsUrl = view?.company?.termsUrl && /^https?:\/\//i.test(view.company.termsUrl) ? view.company.termsUrl : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Bitte geben Sie Ihren Namen an.');
      return;
    }
    if (decision === 'accepted' && termsUrl && !acceptTerms) {
      setError('Bitte bestätigen Sie die Allgemeinen Geschäftsbedingungen.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiService.submitQuoteResponse(token, {
        decision,
        name: name.trim(),
        comment: comment.trim() || undefined,
        acceptTerms: decision === 'accepted' && termsUrl ? acceptTerms : undefined,
      });
      setView((prev) => (prev ? { ...prev, status: 'answered', decision: res.decision, respondedAt: new Date().toISOString() } : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const quote = view?.quote;
  const title = quote ? `Angebot ${quote.quoteNumber}` : 'Angebot';

  const renderBody = () => {
    if (loadError) return <AuthMessage kind="error">{loadError}</AuthMessage>;
    if (!view) return <AuthLoading />;
    if (view.status === 'answered' && view.decision) {
      return (
        <AuthMessage kind="success">
          Das Angebot wurde {view.respondedAt ? `am ${formatDate(view.respondedAt)} ` : ''}{DECISION_TEXT[view.decision]}.
          {view.decision === 'accepted' ? ' Vielen Dank für Ihren Auftrag!' : ' Vielen Dank für Ihre Rückmeldung.'}
        </AuthMessage>
      );
    }
    if (view.status !== 'valid' || !quote) {
      return <AuthMessage kind="error">{STATUS_MESSAGES[view.status === 'valid' || view.status === 'answered' ? 'invalid' : view.status]}</AuthMessage>;
    }

    return (
      <div className="space-y-6">
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-gray-600">Angebotsdatum</dt>
            <dd className="text-right text-gray-900">{formatDate(quote.issueDate)}</dd>
            <dt className="text-gray-600">Gültig bis</dt>
            <dd className="text-right text-gray-900">{formatDate(quote.validUntil)}</dd>
          </dl>
          {quote.items && quote.items.length > 0 && (
            <ul className="divide-y divide-gray-200 border-t border-gray-200">
              {quote.items.map((item, index) => (
                <li key={index} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 break-words text-gray-900">
                    {item.description}
                    <span className="block text-xs text-gray-500">
                      {formatNumber(item.quantity)} × {formatCurrency(item.unitPrice)}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-gray-900">{formatCurrency(item.total)}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gray-200 pt-3">
            <dt className="text-gray-600">Netto</dt>
            <dd className="text-right text-gray-900">{formatCurrency(quote.subtotal ?? 0)}</dd>
            <dt className="text-gray-600">MwSt.</dt>
            <dd className="text-right text-gray-900">{formatCurrency(quote.taxAmount ?? 0)}</dd>
            <dt className="font-semibold text-gray-900">Gesamt</dt>
            <dd className="text-right font-semibold text-gray-900">{formatCurrency(quote.total ?? 0)}</dd>
          </dl>
          <p className="text-xs text-gray-500">Das vollständige Angebot finden Sie als PDF im Anhang der E-Mail.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Entscheidung">
            {(['accepted', 'rejected'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={decision === value}
                onClick={() => setDecision(value)}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  decision === value
                    ? value === 'accepted' ? 'bg-green-50 border-green-500 text-green-800' : 'bg-red-50 border-red-500 text-red-800'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {value === 'accepted' ? 'Annehmen' : 'Ablehnen'}
              </button>
            ))}
          </div>
          <AuthField label="Ihr Name" value={name} onChange={setName} autoComplete="name" autoFocus />
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              {decision === 'accepted' ? 'Anmerkung (optional)' : 'Grund (optional)'}
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </label>
          {decision === 'accepted' && termsUrl && (
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Ich akzeptiere die{' '}
                <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  Allgemeinen Geschäftsbedingungen
                </a>.
              </span>
            </label>
          )}
          <AuthSubmitButton busy={busy}>
            {decision === 'accepted' ? 'Angebot verbindlich annehmen' : 'Angebot ablehnen'}
          </AuthSubmitButton>
        </form>
      </div>
    );
  };

  return (
    <AuthLayout
      title={title}
      subtitle={quote?.customerName ? `für ${quote.customerName}` : undefined}
      brand={view?.company?.name || undefined}
    >
      {renderBody()}
    </AuthLayout>
  );
}
