import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs } from '../context/JobContext';
import { usePlan } from '../context/PlanContext';
import { useQuotes } from '../context/QuoteContext';
import { buildChain, ChainDoc, documentHash, FlowKind, getFlowSteps } from '../utils/documentFlow';
import { DocumentFlow } from './DocumentFlow';

/** Belegkette eines gespeicherten Belegs für die Editor-Köpfe; ohne weitere aktive Module nichts. */
export function DocumentChain({ kind, id }: { kind: FlowKind; id: string }) {
  const { company } = useCompany();
  const { hasFeature } = usePlan();
  const { quotes } = useQuotes();
  const { jobEntries } = useJobs();
  const { invoices } = useInvoices();

  const steps = getFlowSteps({
    quotesEnabled: company.quotesEnabled || false,
    jobsEnabled: company.jobTrackingEnabled || false,
    jobsLicensed: hasFeature('jobs'),
  });
  if (steps.length < 2) return null;

  const chain = buildChain({ kind, id }, { quotes, jobs: jobEntries, invoices });
  // Der Editor, aus dem man wegnavigiert, wird geschlossen – ungespeicherte Änderungen gingen verloren.
  const open = (target: FlowKind, doc: ChainDoc) => {
    if (!window.confirm(`${doc.number} öffnen? Ungespeicherte Änderungen in diesem Beleg gehen verloren.`)) return;
    window.location.hash = documentHash(target, doc);
  };

  return <DocumentFlow steps={steps} chain={chain} currentId={id} onOpen={open} />;
}
