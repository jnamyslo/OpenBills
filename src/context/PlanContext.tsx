import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { apiService, PLAN_ERROR_EVENT } from '../services/api';
import { PlanErrorBody, PlanFeature, PlanInfo } from '../types';
import { UpgradeDialog } from '../components/UpgradeDialog';
import logger from '../utils/logger';
import { useInvoices } from './InvoiceContext';
import { useQuotes } from './QuoteContext';
import { useCustomers } from './CustomerContext';

/** Grund, aus dem der Upgrade-Dialog geöffnet wird. */
export interface UpgradeReason {
  message: string;
}

interface PlanContextType {
  plan: PlanInfo | null;
  /** true, solange der Plan nicht geladen ist – das Backend erzwingt die Grenzen ohnehin. */
  hasFeature: (feature: PlanFeature) => boolean;
  isManaged: boolean;
  refreshPlan: () => Promise<void>;
  showUpgrade: (reason: UpgradeReason) => void;
}

const PlanContext = createContext<PlanContextType | undefined>(undefined);

export function usePlan(): PlanContextType {
  const context = useContext(PlanContext);
  if (context === undefined) {
    throw new Error('usePlan must be used within PlanProvider');
  }
  return context;
}

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  email: 'E-Mail-Versand',
  reminders: 'Mahnwesen',
  jobs: 'Aufträge & Zeiterfassung',
  customerPricing: 'Kundenspezifische Preise & Materialvorlagen',
  reportingFull: 'Erweitertes Reporting',
};

export function featureUpgradeReason(feature: PlanFeature): UpgradeReason {
  return { message: `${FEATURE_LABELS[feature]} ist in Ihrem Tarif nicht enthalten.` };
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [upgradeReason, setUpgradeReason] = useState<UpgradeReason | null>(null);

  const refreshPlan = useCallback(async () => {
    try {
      setPlan(await apiService.getPlan());
    } catch (error) {
      logger.error('Failed to load plan', { error });
    }
  }, []);

  // Nutzung neu laden, sobald sich Rechnungen, Angebote oder Kunden ändern (Freigabe zählt im Backend)
  const { invoices } = useInvoices();
  const { quotes } = useQuotes();
  const { customers } = useCustomers();
  useEffect(() => {
    refreshPlan();
  }, [refreshPlan, invoices, quotes, customers]);

  // Jeder vom Backend abgelehnte Aufruf (402/403) öffnet den Upgrade-Dialog
  useEffect(() => {
    const onPlanError = (event: Event) => {
      const body = (event as CustomEvent<PlanErrorBody>).detail;
      setUpgradeReason({ message: body.error });
      refreshPlan();
    };
    window.addEventListener(PLAN_ERROR_EVENT, onPlanError);
    return () => window.removeEventListener(PLAN_ERROR_EVENT, onPlanError);
  }, [refreshPlan]);

  const value = useMemo<PlanContextType>(() => ({
    plan,
    hasFeature: (feature) => !plan || plan.features.includes(feature),
    isManaged: !!plan && plan.plan !== 'selfhosted',
    refreshPlan,
    showUpgrade: setUpgradeReason,
  }), [plan, refreshPlan]);

  return (
    <PlanContext.Provider value={value}>
      {children}
      {upgradeReason && (
        <UpgradeDialog
          message={upgradeReason.message}
          plan={plan}
          onClose={() => setUpgradeReason(null)}
        />
      )}
    </PlanContext.Provider>
  );
}
