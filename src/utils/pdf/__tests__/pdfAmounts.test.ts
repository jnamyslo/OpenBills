import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobEntry } from '../../../types';
import { formatCurrency } from '../../formatters';
import { testCompany, testCustomer, testInvoice, testItem, testOptions } from './fixtures';

// Gedruckte Texte mitschreiben, um die im PDF ausgewiesenen Beträge zu prüfen.
const printed: string[] = [];
vi.mock('../pdfFonts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../pdfFonts')>();
  return {
    ...original,
    createPdfDocument: async (...args: Parameters<typeof original.createPdfDocument>) => {
      const pdf = await original.createPdfDocument(...args);
      const text = pdf.text.bind(pdf);
      pdf.text = ((value: string | string[], ...rest: unknown[]) => {
        printed.push(...(Array.isArray(value) ? value : [value]));
        return (text as (...a: unknown[]) => unknown)(value, ...rest);
      }) as typeof pdf.text;
      return pdf;
    },
  };
});

const { generateInvoicePDF, generateJobPDF } = await import('../../pdfGenerator');

const eur = (v: number) => formatCurrency(v, 'de-DE');

beforeEach(() => {
  printed.length = 0;
});

describe('Auftrags-PDF rechnet wie die Auftragsrechnung', () => {
  const job = {
    id: 'job-1',
    jobNumber: 'AU-2026-001',
    customerId: 'cust-1',
    customerName: 'Kunde AG',
    title: 'Montage',
    description: 'Einbau',
    date: new Date('2026-11-18'),
    hoursWorked: 0,
    hourlyRate: 0,
    status: 'completed',
    timeEntries: [
      { id: 't1', description: 'Arbeitszeit', hoursWorked: 2, hourlyRate: 50, taxRate: 19, total: 90, discountType: 'fixed', discountValue: 10 },
    ],
    materials: [
      { id: 'm1', description: 'Material', quantity: 3, unitPrice: 20, taxRate: 7, total: 54, discountType: 'percentage', discountValue: 10 },
    ],
    globalDiscountType: 'percentage',
    globalDiscountValue: 10,
    createdAt: new Date('2026-11-18'),
    updatedAt: new Date('2026-11-18'),
  } as unknown as JobEntry;

  it('weist Positions- und Gesamtrabatt aus und rechnet cent-genau', async () => {
    await generateJobPDF(job, { company: testCompany(), customer: testCustomer() });

    // Positionen netto nach Positionsrabatt
    expect(printed).toContain(eur(90));
    expect(printed).toContain(eur(54));
    // Zwischensumme 160, Artikelrabatte 16, Gesamtrabatt 14,40 (auf 144), Netto 129,60
    expect(printed).toContain(eur(160));
    expect(printed).toContain(`-${eur(16)}`);
    expect(printed).toContain(`-${eur(14.4)}`);
    expect(printed).toContain(eur(129.6));
    // Steuer je Satz nach anteiligem Gesamtrabatt: 19 % auf 81,00 = 15,39; 7 % auf 48,60 = 3,40
    expect(printed).toContain(eur(15.39));
    expect(printed).toContain(eur(3.4));
    expect(printed).toContain(eur(148.39));
    // Unrabattierter Betrag darf nicht als Gesamtbetrag erscheinen
    expect(printed).not.toContain(eur(160 + 100 * 0.19 + 60 * 0.07));
  });

  it('zeigt keine leere Arbeitsleistungs-Zeile bei Aufträgen nur mit Material', async () => {
    await generateJobPDF({ ...job, timeEntries: [] }, { company: testCompany(), customer: testCustomer() });
    expect(printed).not.toContain('Arbeitsleistung');
  });
});

describe('Positionsbeträge im Rechnungs-PDF', () => {
  it('rundet wie Summen und E-Rechnung (2,5 × 19,99 = 49,98)', async () => {
    const item = testItem({ quantity: 2.5, unitPrice: 19.99, total: 49.98 });
    await generateInvoicePDF(testInvoice([item], { subtotal: 49.98, taxAmount: 9.5, total: 59.48 }), { ...testOptions(), format: 'zugferd' });
    expect(printed).toContain(eur(49.98));
    expect(printed).not.toContain(eur(49.97));
  });
});
