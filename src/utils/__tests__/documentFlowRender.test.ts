import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentFlow } from '../../components/DocumentFlow';
import { ChainDoc, getFlowSteps } from '../documentFlow';

const doc = (id: string, number: string): ChainDoc => ({ id, number, statusLabel: 'Entwurf', statusClass: 'bg-gray-100' });
const FULL = getFlowSteps({ quotesEnabled: true, jobsEnabled: true, jobsLicensed: true });
const render = (props: Parameters<typeof DocumentFlow>[0]) => renderToStaticMarkup(createElement(DocumentFlow, props));

describe('DocumentFlow', () => {
  it('rendert die Schritte in der Reihenfolge Angebot, Auftrag, Rechnung', () => {
    const html = render({ steps: FULL });
    expect(html.indexOf('Angebot')).toBeLessThan(html.indexOf('Auftrag'));
    expect(html.indexOf('Auftrag')).toBeLessThan(html.indexOf('Rechnung'));
  });

  it('zeigt "Noch nicht erstellt" für Schritte ohne Beleg', () => {
    const html = render({ steps: FULL, chain: { quote: [doc('q', 'AN-1')] } });
    expect(html.match(/Noch nicht erstellt/g)).toHaveLength(2);
    expect(html).toContain('AN-1');
  });

  it('stapelt mehrere Belege eines Schritts und zählt sie', () => {
    const html = render({ steps: FULL, chain: { job: [doc('1', 'AB-1'), doc('2', 'AB-2')] } });
    expect(html).toContain('AB-1');
    expect(html).toContain('AB-2');
    expect(html).toContain('>2<');
  });

  it('kürzt lange Stapel und nennt die Restzahl', () => {
    const jobs = ['1', '2', '3', '4', '5'].map(n => doc(n, `AB-${n}`));
    const html = render({ steps: FULL, chain: { job: jobs } });
    expect(html).toContain('AB-3');
    expect(html).not.toContain('AB-4');
    expect(html).toContain('+ 2 weitere');
  });

  it('hebt den aktuellen Beleg hervor', () => {
    const html = render({ steps: FULL, chain: { quote: [doc('q1', 'AN-1'), doc('q2', 'AN-2')] }, currentId: 'q2' });
    expect(html.match(/ring-1/g)).toHaveLength(1);
  });

  it('zeigt gesperrte Schritte mit Tarifhinweis statt Belegen', () => {
    const steps = getFlowSteps({ quotesEnabled: true, jobsEnabled: true, jobsLicensed: false });
    const html = render({ steps, chain: { job: [doc('1', 'AB-1')] } });
    expect(html).toContain('Im Tarif nicht enthalten');
    expect(html).not.toContain('AB-1');
  });

  it('zeigt in der kompakten Vorschau keine Belegfelder', () => {
    const html = render({ steps: FULL, compact: true });
    expect(html).not.toContain('Noch nicht erstellt');
    expect(html).toContain('Angebot');
  });

  it('rendert ohne Module nur die Rechnung', () => {
    const steps = getFlowSteps({ quotesEnabled: false, jobsEnabled: false, jobsLicensed: true });
    const html = render({ steps });
    expect(html).toContain('Rechnung');
    expect(html).not.toContain('Angebot');
    expect(html).not.toContain('Auftrag');
  });
});

describe('DocumentFlow – Navigation', () => {
  it('macht Belege nur mit onOpen anklickbar', () => {
    const chain = { quote: [doc('q1', 'AN-1')] };
    expect(render({ steps: FULL, chain })).not.toContain('<button');
    expect(render({ steps: FULL, chain, onOpen: () => {} })).toContain('<button');
  });

  it('der aktuelle Beleg ist nicht anklickbar', () => {
    const html = render({ steps: FULL, chain: { quote: [doc('q1', 'AN-1')] }, currentId: 'q1', onOpen: () => {} });
    expect(html).not.toContain('<button');
  });
});
