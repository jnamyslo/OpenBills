import { Briefcase, Check, ChevronDown, ChevronRight, FileText, Lock, Receipt } from 'lucide-react';
import { ChainDoc, FlowChain, FlowKind, FlowStep } from '../utils/documentFlow';

const ICONS: Record<FlowKind, typeof FileText> = { quote: FileText, job: Briefcase, invoice: Receipt };
const MAX_VISIBLE = 3;

interface DocumentFlowProps {
  steps: FlowStep[];
  /** Belege je Schritt; mehrere Belege eines Schritts werden gestapelt. */
  chain?: Partial<FlowChain>;
  /** Beleg, in dem die Kette gerade angezeigt wird (wird hervorgehoben). */
  currentId?: string;
  /** Nur Schritte zeigen (Vorschau in den Einstellungen). */
  compact?: boolean;
  /** Macht Belege (außer dem aktuellen) anklickbar. */
  onOpen?: (kind: FlowKind, doc: ChainDoc) => void;
}

function DocRow({ doc, current, onOpen }: { doc: ChainDoc; current: boolean; onOpen?: () => void }) {
  const className = `flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left ${current ? 'bg-primary-light-custom ring-1 ring-primary-custom/40' : 'bg-gray-50'}`;
  const content = (
    <>
      <span className="text-sm font-semibold text-gray-900 truncate">{doc.number}</span>
      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${doc.statusClass}`}>{doc.statusLabel}</span>
    </>
  );
  if (!onOpen || current) return <div className={className}>{content}</div>;
  return (
    <button type="button" onClick={onOpen} className={`${className} hover:bg-gray-100 transition-colors`} title={`${doc.number} öffnen`}>
      {content}
    </button>
  );
}

/** Belegkette Angebot → Auftrag → Rechnung; mobil untereinander, mehrere Belege je Schritt gestapelt. */
export function DocumentFlow({ steps, chain = {}, currentId, compact = false, onOpen }: DocumentFlowProps) {
  return (
    <ol className="flex flex-col sm:flex-row sm:items-stretch gap-2" aria-label="Belegkette">
      {steps.map((step, index) => {
        const docs = chain[step.kind] ?? [];
        const reached = docs.length > 0;
        const Icon = step.locked ? Lock : ICONS[step.kind];
        const boxClass = step.locked
          ? 'border-dashed border-gray-300 bg-gray-50 text-gray-400'
          : reached
            ? 'border-gray-200 bg-white shadow-sm'
            : 'border-dashed border-gray-300 bg-gray-50 text-gray-500';
        const visible = docs.slice(0, MAX_VISIBLE);
        const hidden = docs.length - visible.length;
        return (
          <li key={step.kind} className="flex flex-col sm:flex-row sm:flex-1 sm:items-center gap-2 min-w-0">
            <div className={`flex-1 min-w-0 rounded-xl border p-3 ${boxClass}`}>
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full ${reached ? 'bg-primary-custom text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {reached && !compact ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide">{step.label}</span>
                {docs.length > 1 && (
                  <span className="ml-auto rounded-full bg-gray-100 px-2 text-xs font-medium text-gray-700">{docs.length}</span>
                )}
              </div>
              {step.locked ? (
                <div className="mt-2 text-xs">Im Tarif nicht enthalten</div>
              ) : !compact && (
                <div className="mt-2 space-y-1">
                  {reached ? (
                    <>
                      {visible.map(doc => (
                        <DocRow key={doc.id} doc={doc} current={doc.id === currentId} onOpen={onOpen && (() => onOpen(step.kind, doc))} />
                      ))}
                      {hidden > 0 && <div className="px-2 text-xs text-gray-500">+ {hidden} weitere</div>}
                    </>
                  ) : (
                    <div className="text-sm text-gray-500">Noch nicht erstellt</div>
                  )}
                </div>
              )}
            </div>
            {index < steps.length - 1 && (
              <>
                <ChevronRight className="hidden sm:block h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                <ChevronDown className="sm:hidden h-5 w-5 mx-auto text-gray-400" aria-hidden="true" />
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
