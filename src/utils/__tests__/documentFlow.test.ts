import { describe, it, expect } from 'vitest';
import { buildChain, documentHash, getFlowSteps } from '../documentFlow';

const kinds = (c: Parameters<typeof getFlowSteps>[0]) => getFlowSteps(c).map(s => s.kind);

describe('getFlowSteps', () => {
  it('zeigt ohne Module nur die Rechnung', () => {
    expect(kinds({ quotesEnabled: false, jobsEnabled: false, jobsLicensed: true })).toEqual(['invoice']);
  });

  it('zeigt Angebot → Rechnung', () => {
    expect(kinds({ quotesEnabled: true, jobsEnabled: false, jobsLicensed: true })).toEqual(['quote', 'invoice']);
  });

  it('zeigt Auftrag → Rechnung', () => {
    expect(kinds({ quotesEnabled: false, jobsEnabled: true, jobsLicensed: true })).toEqual(['job', 'invoice']);
  });

  it('zeigt die volle Kette in der richtigen Reihenfolge', () => {
    expect(kinds({ quotesEnabled: true, jobsEnabled: true, jobsLicensed: true })).toEqual(['quote', 'job', 'invoice']);
  });

  it('markiert den Auftrag als gesperrt, wenn der Tarif ihn nicht enthält', () => {
    const job = getFlowSteps({ quotesEnabled: true, jobsEnabled: true, jobsLicensed: false }).find(s => s.kind === 'job');
    expect(job?.locked).toBe(true);
  });

  it('blendet den Auftrag aus, wenn das Modul aus ist – auch ohne Lizenz', () => {
    expect(kinds({ quotesEnabled: true, jobsEnabled: false, jobsLicensed: false })).toEqual(['quote', 'invoice']);
  });
});


describe('buildChain', () => {
  const quotes = [
    { id: 'q1', quoteNumber: 'AN-1', status: 'accepted' },
    { id: 'q2', quoteNumber: 'AN-2', status: 'billed', convertedToInvoiceId: 'i2' },
  ];
  const jobs = [
    { id: 'j1', jobNumber: 'AB-1', status: 'invoiced', quoteId: 'q1', invoiceId: 'i1' },
    { id: 'j2', jobNumber: 'AB-2', status: 'invoiced', quoteId: null, invoiceId: 'i1' },
    { id: 'j3', jobNumber: 'AB-3', status: 'draft', quoteId: 'q1', invoiceId: null },
  ];
  const invoices = [
    { id: 'i1', invoiceNumber: 'RE-1', status: 'paid' },
    { id: 'i2', invoiceNumber: 'RE-2', status: 'sent' },
  ];
  const numbers = (docs: { number: string }[]) => docs.map(d => d.number);

  it('ab Angebot: Aufträge und deren Rechnungen, ohne Duplikate', () => {
    const chain = buildChain({ kind: 'quote', id: 'q1' }, { quotes, jobs, invoices });
    expect(numbers(chain.quote)).toEqual(['AN-1']);
    expect(numbers(chain.job)).toEqual(['AB-1', 'AB-3']);
    expect(numbers(chain.invoice)).toEqual(['RE-1']);
  });

  it('ab Angebot ohne Auftrag: direkte Abrechnung', () => {
    const chain = buildChain({ kind: 'quote', id: 'q2' }, { quotes, jobs, invoices });
    expect(numbers(chain.job)).toEqual([]);
    expect(numbers(chain.invoice)).toEqual(['RE-2']);
  });

  it('ab Auftrag: Herkunft und Rechnung, keine Geschwister', () => {
    const chain = buildChain({ kind: 'job', id: 'j1' }, { quotes, jobs, invoices });
    expect(numbers(chain.quote)).toEqual(['AN-1']);
    expect(numbers(chain.job)).toEqual(['AB-1']);
    expect(numbers(chain.invoice)).toEqual(['RE-1']);
  });

  it('ab Sammelrechnung: alle abgerechneten Aufträge und ihre Angebote', () => {
    const chain = buildChain({ kind: 'invoice', id: 'i1' }, { quotes, jobs, invoices });
    expect(numbers(chain.job)).toEqual(['AB-1', 'AB-2']);
    expect(numbers(chain.quote)).toEqual(['AN-1']);
  });

  it('übersetzt Status in Text', () => {
    const chain = buildChain({ kind: 'invoice', id: 'i1' }, { quotes, jobs, invoices });
    expect(chain.invoice[0].statusLabel).toBe('Bezahlt');
  });
});


describe('documentHash', () => {
  it('öffnet Angebote über die Editor-Route', () => {
    expect(documentHash('quote', { id: 'abc', number: 'AN-1' })).toBe('quote-editor/abc');
  });

  it('öffnet Aufträge und Rechnungen über die Liste mit Status „Alle“ und Belegnummer', () => {
    expect(documentHash('job', { id: 'j', number: 'AB-2026-001' })).toBe('jobs/all/AB-2026-001');
    expect(documentHash('invoice', { id: 'i', number: 'RE-2026-001' })).toBe('invoices/all/RE-2026-001');
  });

  it('kodiert Schrägstriche in Belegnummern, damit der Hash nicht zerfällt', () => {
    const hash = documentHash('invoice', { id: 'i', number: 'RE/2026/1' });
    expect(hash.split('/')).toHaveLength(3);
    expect(decodeURIComponent(hash.split('/')[2])).toBe('RE/2026/1');
  });
});
