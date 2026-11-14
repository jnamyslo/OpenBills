import { ReactNode, useState } from 'react';
import { Building2, CheckCircle2, ExternalLink, Landmark, Lightbulb, Mail, Receipt, Rocket, Bell, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { FEATURE_LABELS, usePlan } from '../context/PlanContext';
import { getOnboardingSteps, OnboardingStepId } from '../utils/onboarding';
import { isAdmin } from '../utils/authRoutes';
import logger from '../utils/logger';
import type { Company, PlanFeature } from '../types';

const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-custom';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

/** Hinweis mit Link in den passenden Einstellungsbereich (neuer Tab, damit der Assistent offen bleibt). */
function Hint({ children, section }: { children: ReactNode; section?: string }) {
  return (
    <div className="mt-5 flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <Lightbulb className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div>
        {children}
        {section && (
          <a
            href={`#settings/${section}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-medium underline"
          >
            Alle Optionen in den Einstellungen <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

const TITLES: Record<OnboardingStepId, { title: string; icon: typeof Rocket }> = {
  welcome: { title: 'Willkommen bei OpenBills', icon: Rocket },
  firma: { title: 'Ihre Firmendaten', icon: Building2 },
  zahlung: { title: 'Bankverbindung', icon: Landmark },
  rechnungen: { title: 'Rechnungen', icon: Receipt },
  mahnwesen: { title: 'Mahnwesen', icon: Bell },
  email: { title: 'E-Mail-Versand', icon: Mail },
  fertig: { title: 'Fertig!', icon: CheckCircle2 },
};

// Funktionen, auf die am Ende hingewiesen wird, falls der Tarif sie nicht enthält.
const UPSELL_FEATURES: PlanFeature[] = ['reminders', 'jobs', 'reportingFull', 'ownSmtp'];

/** Einrichtungsassistent nach der Ersteinrichtung: Firma, Zahlung, Rechnungen, Mahnwesen, E-Mail – je nach Rolle und Tarif. */
export function OnboardingWizard() {
  const { user, setOnboardingCompleted } = useAuth();
  const { company, updateCompany } = useCompany();
  const { plan, hasFeature } = usePlan();
  const steps = getOnboardingSteps(isAdmin(user), hasFeature);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Company>(company);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[index];
  const { title, icon: Icon } = TITLES[step];
  const isLast = index === steps.length - 1;
  const set = (patch: Partial<Company>) => setDraft((prev) => ({ ...prev, ...patch }));
  const setPayment = (patch: Partial<NonNullable<Company['paymentInformation']>>) =>
    set({ paymentInformation: { ...draft.paymentInformation, ...patch } });

  const finish = async () => {
    try {
      await setOnboardingCompleted(true);
    } catch (err) {
      logger.error('Onboarding konnte nicht gespeichert werden:', err);
      setError('Der Fortschritt konnte nicht gespeichert werden. Bitte erneut versuchen.');
      setBusy(false);
    }
  };

  const next = async () => {
    setError(null);
    if (step === 'firma' && !draft.name.trim()) {
      setError('Bitte geben Sie einen Firmennamen an.');
      return;
    }
    setBusy(true);
    try {
      // Nur Schritte mit Eingaben speichern; immer auf dem aktuellen Firmenstand aufsetzen.
      if (['firma', 'zahlung', 'rechnungen', 'mahnwesen'].includes(step)) {
        await updateCompany({ ...company, ...pick(draft, step) });
      }
    } catch (err) {
      logger.error('Onboarding: Speichern fehlgeschlagen:', err);
      setError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
      setBusy(false);
      return;
    }
    if (isLast) {
      await finish();
      return;
    }
    setBusy(false);
    setIndex(index + 1);
  };

  const missing = UPSELL_FEATURES.filter((f) => !hasFeature(f));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Einrichtungsassistent">
      <div className="flex max-h-full w-full max-w-xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center">
            <Icon className="h-5 w-5 text-primary-custom mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          </div>
          <button
            onClick={() => { setBusy(true); void finish(); }}
            className="flex items-center text-sm text-gray-500 hover:text-gray-700"
            aria-label="Einrichtung überspringen"
          >
            Später <X className="h-4 w-4 ml-1" />
          </button>
        </div>

        <div className="h-1 bg-gray-100">
          <div className="h-1 bg-primary-custom transition-all" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-4">
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

          {step === 'welcome' && (
            <>
              <p className="text-gray-700">
                Hallo {user?.name}! {isAdmin(user)
                  ? 'In wenigen Schritten richten wir die wichtigsten Einstellungen ein, damit Ihre erste Rechnung vollständig und rechtssicher wird.'
                  : 'Schön, dass Sie dabei sind. Ihr Administrator hat die Firmeneinstellungen bereits vorgenommen.'}
              </p>
              {plan && <p className="text-sm text-gray-500">Ihr Tarif: <strong>{plan.label}</strong></p>}
              <Hint>Alle Angaben lassen sich später jederzeit in den Einstellungen ändern. Über das Benutzermenü können Sie diesen Assistenten erneut starten.</Hint>
            </>
          )}

          {step === 'firma' && (
            <>
              <Field label="Firmenname *">
                <input className={INPUT} value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
              </Field>
              <Field label="Straße und Hausnummer">
                <input className={INPUT} value={draft.address} onChange={(e) => set({ address: e.target.value })} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="PLZ">
                  <input className={INPUT} value={draft.postalCode} onChange={(e) => set({ postalCode: e.target.value })} />
                </Field>
                <div className="col-span-2">
                  <Field label="Ort">
                    <input className={INPUT} value={draft.city} onChange={(e) => set({ city: e.target.value })} />
                  </Field>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="E-Mail">
                  <input type="email" className={INPUT} value={draft.email} onChange={(e) => set({ email: e.target.value })} />
                </Field>
                <Field label="Telefon">
                  <input className={INPUT} value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
                </Field>
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="custom-checkbox mt-1 flex-shrink-0"
                  checked={draft.isSmallBusiness || false}
                  onChange={(e) => set({ isSmallBusiness: e.target.checked })}
                />
                <span>
                  <strong>Kleinunternehmer (§ 19 UStG)</strong> – Rechnungen werden ohne Umsatzsteuer ausgestellt, eine USt-IdNr. ist nicht nötig.
                </span>
              </label>
              {!draft.isSmallBusiness && (
                <Field label="USt-IdNr." hint="Pflichtangabe auf Rechnungen, sofern Sie umsatzsteuerpflichtig sind.">
                  <input className={INPUT} value={draft.taxId} onChange={(e) => set({ taxId: e.target.value })} />
                </Field>
              )}
              <Hint section="firmenprofil">Steuer-ID, Webseite, Logo und PDF-Kopfzeile pflegen Sie unter Firmenprofil und Erscheinungsbild. Für eRechnungen (ZUGFeRD/XRechnung) sind vollständige Adress- und Kontaktdaten wichtig.</Hint>
            </>
          )}

          {step === 'zahlung' && (
            <>
              <Field label="Kontoinhaber">
                <input className={INPUT} value={draft.paymentInformation?.accountHolder ?? draft.name} onChange={(e) => setPayment({ accountHolder: e.target.value })} />
              </Field>
              <Field label="IBAN">
                <input className={INPUT} value={draft.paymentInformation?.bankAccount ?? ''} onChange={(e) => setPayment({ bankAccount: e.target.value })} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="BIC">
                  <input className={INPUT} value={draft.paymentInformation?.bic ?? ''} onChange={(e) => setPayment({ bic: e.target.value })} />
                </Field>
                <Field label="Bank">
                  <input className={INPUT} value={draft.paymentInformation?.bankName ?? ''} onChange={(e) => setPayment({ bankName: e.target.value })} />
                </Field>
              </div>
              <Hint section="zahlung">Die Bankverbindung erscheint im Zahlungsblock der Rechnung und im QR-Code. Zahlungsbedingungen und -methoden legen Sie in den Einstellungen fest.</Hint>
            </>
          )}

          {step === 'rechnungen' && (
            <>
              <Field label="Standard-Zahlungsziel (Tage)">
                <input
                  type="number"
                  min="0"
                  className={INPUT}
                  value={draft.defaultPaymentDays ?? 30}
                  onChange={(e) => set({ defaultPaymentDays: e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                />
              </Field>
              <Hint section="nummernkreise">Rechnungsnummern, Zahlenformat und eRechnung (ZUGFeRD, XRechnung) stellen Sie unter Rechnungen, Nummernkreise und eRechnung ein. Wechseln Sie von einem anderen System, setzen Sie dort die Startnummer.</Hint>
            </>
          )}

          {step === 'mahnwesen' && (
            <>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="custom-checkbox mt-1 flex-shrink-0"
                  checked={draft.remindersEnabled ?? false}
                  onChange={(e) => set({ remindersEnabled: e.target.checked })}
                />
                <span><strong>Mahnwesen aktivieren</strong> – überfällige Rechnungen erkennen und Zahlungserinnerungen versenden.</span>
              </label>
              {draft.remindersEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Tage nach Fälligkeit bis zur 1. Mahnung" hint="0 = sofort mahnbar">
                    <input type="number" min="0" className={INPUT} value={draft.reminderDaysAfterDue ?? 7}
                      onChange={(e) => set({ reminderDaysAfterDue: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                  </Field>
                  <Field label="Tage zwischen Mahnstufen" hint="0 = sofort erneut mahnbar">
                    <input type="number" min="0" className={INPUT} value={draft.reminderDaysBetween ?? 7}
                      onChange={(e) => set({ reminderDaysBetween: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                  </Field>
                </div>
              )}
              <Hint section="mahnwesen">Mahngebühren und die Texte der drei Mahnstufen passen Sie unter Mahnwesen an. Mahnungen versenden Sie anschließend im Bereich „Mahnungen“.</Hint>
            </>
          )}

          {step === 'email' && (
            <>
              <p className="text-gray-700">
                {plan?.mailRoutes.customer === 'own'
                  ? 'Rechnungen und Angebote versenden Sie über Ihren eigenen Mailserver. Hinterlegen Sie dazu die SMTP-Zugangsdaten.'
                  : 'Rechnungen und Angebote werden über OpenBills versendet. Antworten Ihrer Kunden gehen an Ihre Firmen-E-Mail-Adresse – diese sollte daher im Firmenprofil hinterlegt sein.'}
              </p>
              <Hint section="email">
                {plan?.mailRoutes.customer === 'own'
                  ? 'Unter E-Mail finden Sie SMTP-Einstellungen, Verbindungstest, Vorlagen und die Versandhistorie.'
                  : 'Unter E-Mail sehen Sie Versandhistorie und Vorlagen. Mit einem höheren Tarif können Sie einen eigenen Absender nutzen.'}
              </Hint>
            </>
          )}

          {step === 'fertig' && (
            <>
              <p className="text-gray-700">
                {isAdmin(user)
                  ? 'Die Grundeinrichtung ist abgeschlossen. So geht es weiter:'
                  : 'Los geht es! Die wichtigsten Bereiche finden Sie in der Navigation links.'}
              </p>
              <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Legen Sie unter <strong>Kunden</strong> Ihren ersten Kunden an.</li>
                <li>Erstellen Sie unter <strong>Rechnungen</strong> Ihre erste Rechnung.</li>
                {isAdmin(user) && <li>Laden Sie weitere Kolleginnen und Kollegen unter Einstellungen → Benutzer ein und aktivieren Sie die Zwei-Faktor-Anmeldung im Konto.</li>}
              </ul>
              {isAdmin(user) && missing.length > 0 && (
                <Hint>
                  In Ihrem Tarif nicht enthalten: {missing.map((f) => FEATURE_LABELS[f]).join(', ')}.
                  {plan?.upgradeContact && <> Kontakt für ein Upgrade: {plan.upgradeContact}.</>}
                </Hint>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-4">
          <button
            onClick={() => setIndex(index - 1)}
            disabled={index === 0 || busy}
            className="px-4 py-2 text-sm text-gray-700 rounded-lg hover:bg-gray-100 disabled:invisible"
          >
            Zurück
          </button>
          <span className="text-xs text-gray-400">Schritt {index + 1} von {steps.length}</span>
          <button
            onClick={() => void next()}
            disabled={busy}
            className="px-4 py-2 text-sm text-white rounded-lg bg-primary-custom hover:opacity-90 disabled:opacity-60"
          >
            {isLast ? 'Los geht’s' : 'Weiter'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Nur die Felder des jeweiligen Schritts aus dem Entwurf übernehmen. */
function pick(draft: Company, step: OnboardingStepId): Partial<Company> {
  switch (step) {
    case 'firma':
      return {
        name: draft.name.trim(), address: draft.address, postalCode: draft.postalCode, city: draft.city,
        email: draft.email, phone: draft.phone, taxId: draft.taxId,
        isSmallBusiness: draft.isSmallBusiness,
      };
    case 'zahlung':
      return { paymentInformation: draft.paymentInformation };
    case 'rechnungen':
      return { defaultPaymentDays: draft.defaultPaymentDays };
    case 'mahnwesen':
      return {
        remindersEnabled: draft.remindersEnabled,
        reminderDaysAfterDue: draft.reminderDaysAfterDue,
        reminderDaysBetween: draft.reminderDaysBetween,
      };
    default:
      return {};
  }
}
