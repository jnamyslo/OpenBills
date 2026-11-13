import { Lock } from 'lucide-react';
import { PlanFeature } from '../types';
import { FEATURE_LABELS, featureUpgradeReason, usePlan } from '../context/PlanContext';

interface PlanLockedNoticeProps {
  feature: PlanFeature;
  /** Kompakte Variante für Abschnitte innerhalb einer Seite */
  compact?: boolean;
}

/** Platzhalter für Seiten oder Abschnitte, deren Feature nicht im Tarif enthalten ist. */
export function PlanLockedNotice({ feature, compact = false }: PlanLockedNoticeProps) {
  const { plan, showUpgrade } = usePlan();

  return (
    <div className={compact ? 'p-4 lg:p-6 text-center' : 'p-6 lg:p-12 flex justify-center'}>
      <div className={compact ? '' : 'max-w-md text-center bg-white rounded-lg shadow-sm border border-gray-200 p-6 lg:p-8'}>
        <Lock className={`mx-auto mb-3 text-gray-400 ${compact ? 'h-8 w-8' : 'h-12 w-12'}`} />
        <h2 className={`font-semibold text-gray-900 ${compact ? 'text-base' : 'text-lg'}`}>{FEATURE_LABELS[feature]}</h2>
        <p className="text-sm text-gray-600 mt-2">
          Diese Funktion ist im Tarif {plan?.label ?? ''} nicht enthalten.
        </p>
        <button
          onClick={() => showUpgrade(featureUpgradeReason(feature))}
          className="mt-4 btn-primary text-white px-4 py-2 rounded-lg hover:brightness-90 transition-colors text-sm"
        >
          Tarif upgraden
        </button>
      </div>
    </div>
  );
}
