export type FlowKind = 'quote' | 'job' | 'invoice';

export interface FlowStep {
  kind: FlowKind;
  label: string;
  /** Modul ist eingeschaltet, aber im Tarif nicht enthalten. */
  locked: boolean;
}

export interface FlowConfig {
  quotesEnabled: boolean;
  jobsEnabled: boolean;
  jobsLicensed: boolean;
}

const LABELS: Record<FlowKind, string> = {
  quote: 'Angebot',
  job: 'Auftrag',
  invoice: 'Rechnung',
};

/** Belegkette je nach aktiven (und lizenzierten) Modulen. Die Rechnung ist immer das Ende. */
export function getFlowSteps({ quotesEnabled, jobsEnabled, jobsLicensed }: FlowConfig): FlowStep[] {
  const steps: FlowStep[] = [];
  if (quotesEnabled) steps.push({ kind: 'quote', label: LABELS.quote, locked: false });
  if (jobsEnabled) steps.push({ kind: 'job', label: LABELS.job, locked: !jobsLicensed });
  steps.push({ kind: 'invoice', label: LABELS.invoice, locked: false });
  return steps;
}

// ============================================================================
// Belegkette eines konkreten Belegs
// ============================================================================

export interface ChainDoc {
  id: string;
  number: string;
  statusLabel: string;
  statusClass: string;
}

export type FlowChain = Record<FlowKind, ChainDoc[]>;

interface ChainQuote { id: string; quoteNumber: string; status: string; convertedToInvoiceId?: string | null }
interface ChainJob { id: string; jobNumber: string; status: string; quoteId?: string | null; invoiceId?: string | null }
interface ChainInvoice { id: string; invoiceNumber: string; status: string }

const QUOTE_STATUS: Record<string, [string, string]> = {
  draft: ['Entwurf', 'bg-gray-100 text-gray-800'],
  sent: ['Gesendet', 'bg-blue-100 text-blue-800'],
  accepted: ['Akzeptiert', 'bg-green-100 text-green-800'],
  rejected: ['Abgelehnt', 'bg-red-100 text-red-800'],
  expired: ['Abgelaufen', 'bg-yellow-100 text-yellow-800'],
  billed: ['Abgerechnet', 'bg-blue-100 text-blue-800'],
};
const JOB_STATUS: Record<string, [string, string]> = {
  draft: ['Entwurf', 'bg-gray-100 text-gray-800'],
  'in-progress': ['In Arbeit', 'bg-yellow-100 text-yellow-800'],
  completed: ['Abgeschlossen', 'bg-green-100 text-green-800'],
  invoiced: ['Abgerechnet', 'bg-blue-100 text-blue-800'],
};
const INVOICE_STATUS: Record<string, [string, string]> = {
  draft: ['Entwurf', 'bg-gray-100 text-gray-800'],
  sent: ['Gesendet', 'bg-blue-100 text-blue-800'],
  paid: ['Bezahlt', 'bg-green-100 text-green-800'],
  overdue: ['Überfällig', 'bg-red-100 text-red-800'],
  reminded_1x: ['1. Mahnung', 'bg-orange-100 text-orange-800'],
  reminded_2x: ['2. Mahnung', 'bg-orange-100 text-orange-800'],
  reminded_3x: ['3. Mahnung', 'bg-red-100 text-red-800'],
  cancelled: ['Storniert', 'bg-gray-100 text-gray-500 line-through'],
};

const statusOf = (table: Record<string, [string, string]>, status: string): [string, string] =>
  table[status] ?? [status, 'bg-gray-100 text-gray-800'];

/**
 * Belege, die mit dem Anker zusammenhängen – vom Anker aus nach oben (Herkunft)
 * und nach unten (Folgebelege). Geschwister-Belege (andere Aufträge derselben
 * Sammelrechnung) gehören bewusst nicht dazu.
 */
export function buildChain(
  anchor: { kind: FlowKind; id: string },
  data: { quotes: ChainQuote[]; jobs: ChainJob[]; invoices: ChainInvoice[] }
): FlowChain {
  const { quotes, jobs, invoices } = data;
  const quoteIds = new Set<string>();
  const jobIds = new Set<string>();
  const invoiceIds = new Set<string>();

  if (anchor.kind === 'quote') {
    quoteIds.add(anchor.id);
    const quote = quotes.find(q => q.id === anchor.id);
    if (quote?.convertedToInvoiceId) invoiceIds.add(quote.convertedToInvoiceId);
    for (const job of jobs.filter(j => j.quoteId === anchor.id)) {
      jobIds.add(job.id);
      if (job.invoiceId) invoiceIds.add(job.invoiceId);
    }
  } else if (anchor.kind === 'job') {
    jobIds.add(anchor.id);
    const job = jobs.find(j => j.id === anchor.id);
    if (job?.quoteId) quoteIds.add(job.quoteId);
    if (job?.invoiceId) invoiceIds.add(job.invoiceId);
  } else {
    invoiceIds.add(anchor.id);
    for (const job of jobs.filter(j => j.invoiceId === anchor.id)) {
      jobIds.add(job.id);
      if (job.quoteId) quoteIds.add(job.quoteId);
    }
    for (const quote of quotes.filter(q => q.convertedToInvoiceId === anchor.id)) quoteIds.add(quote.id);
  }

  return {
    quote: quotes.filter(q => quoteIds.has(q.id)).map(q => {
      const [statusLabel, statusClass] = statusOf(QUOTE_STATUS, q.status);
      return { id: q.id, number: q.quoteNumber, statusLabel, statusClass };
    }),
    job: jobs.filter(j => jobIds.has(j.id)).map(j => {
      const [statusLabel, statusClass] = statusOf(JOB_STATUS, j.status);
      return { id: j.id, number: j.jobNumber, statusLabel, statusClass };
    }),
    invoice: invoices.filter(i => invoiceIds.has(i.id)).map(i => {
      const [statusLabel, statusClass] = statusOf(INVOICE_STATUS, i.status);
      return { id: i.id, number: i.invoiceNumber, statusLabel, statusClass };
    }),
  };
}

/**
 * Hash-Route, die einen Beleg öffnet. Angebote haben eine eigene Editor-Route; Rechnungen und
 * Aufträge werden in ihrer Liste per Suche auf die Belegnummer gefunden (Status „Alle“, sonst
 * wären abgerechnete Belege ausgeblendet).
 */
export function documentHash(kind: FlowKind, doc: { id: string; number: string }): string {
  switch (kind) {
    case 'quote': return `quote-editor/${doc.id}`;
    case 'job': return `jobs/all/${encodeURIComponent(doc.number)}`;
    case 'invoice': return `invoices/all/${encodeURIComponent(doc.number)}`;
  }
}
