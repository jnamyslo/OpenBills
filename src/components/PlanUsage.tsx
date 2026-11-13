import { usePlan } from '../context/PlanContext';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const ratio = limit ? Math.min(used / limit, 1) : 0;
  const barColor = ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-primary-custom';
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className={ratio >= 1 ? 'text-red-600 font-medium' : ''}>
          {used} / {limit ?? '∞'}
        </span>
      </div>
      {limit !== null && (
        <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
          <div className={`h-full ${barColor}`} style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** Tarif und Nutzung im laufenden Monat. Nur bei Managed-SaaS-Instanzen sichtbar. */
export function PlanUsage() {
  const { plan, isManaged, showUpgrade } = usePlan();
  if (!plan || !isManaged) return null;

  const month = MONTHS[Number(plan.usage.period.slice(5, 7)) - 1] ?? plan.usage.period;
  const { limits, usage } = plan;

  return (
    <div className="mt-6 p-3 border border-gray-200 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-900">Tarif {plan.label}</span>
        <span className="text-xs text-gray-500">{month}</span>
      </div>
      <UsageRow label="Rechnungen" used={usage.invoices} limit={limits.invoicesPerMonth} />
      <UsageRow label="Angebote" used={usage.quotes} limit={limits.quotesPerMonth} />
      <UsageRow label="Kunden" used={usage.customers} limit={limits.customers} />
      {plan.plan !== 'enterprise' && (
        <button
          onClick={() => showUpgrade({ message: 'Mehr Rechnungen, Angebote, Kunden und Funktionen mit einem höheren Tarif.' })}
          className="w-full text-xs text-primary-custom hover:underline pt-1"
        >
          Tarif upgraden
        </button>
      )}
    </div>
  );
}
