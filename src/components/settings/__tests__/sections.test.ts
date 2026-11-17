import { describe, it, expect } from 'vitest';
import type { Company } from '../../../types';
import {
  SETTINGS_SECTIONS,
  resolveSection,
  mergeSectionFields,
  isSectionDirty,
  pickSectionFields,
} from '../sections';

const company: Company = {
  name: 'Muster GmbH',
  address: 'Weg 1',
  city: 'Stadt',
  postalCode: '12345',
  country: 'Deutschland',
  phone: '0123',
  email: 'info@example.com',
  taxId: 'DE123',
  paymentInformation: { bankAccount: 'DE00' },
  reminderFeeStage1: 5,
};

describe('resolveSection', () => {
  it('kennt alle 13 Bereiche', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toHaveLength(13);
  });

  it('löst gültige IDs auf, case-insensitiv', () => {
    expect(resolveSection('zahlung')).toBe('zahlung');
    expect(resolveSection('Zahlung')).toBe('zahlung');
  });

  it('Fallback bei leer/unbekannt', () => {
    expect(resolveSection(undefined)).toBe('firmenprofil');
    expect(resolveSection('')).toBe('firmenprofil');
    expect(resolveSection('foo')).toBe('firmenprofil');
  });
});

describe('Feldzuordnung', () => {
  it('kein Company-Feld gehört zu zwei Bereichen', () => {
    const all = SETTINGS_SECTIONS.flatMap((s) => s.fields);
    expect(new Set(all).size).toBe(all.length);
  });

  it('showCombinedDropdowns liegt nicht in einem Button-Bereich', () => {
    expect(SETTINGS_SECTIONS.flatMap((s) => s.fields)).not.toContain('showCombinedDropdowns');
  });

  it('Rubriken in Reihenfolge Firma, Dokumente, System', () => {
    const groups = [...new Set(SETTINGS_SECTIONS.map((s) => s.group))];
    expect(groups).toEqual(['Firma', 'Dokumente', 'System']);
  });
});

describe('mergeSectionFields', () => {
  it('nimmt nur Bereichsfelder aus dem Entwurf', () => {
    const current: Company = { ...company, name: 'Neu (anderer Bereich)' };
    const draft: Company = { ...company, name: 'Alt', paymentInformation: { bankAccount: 'DE99' } };
    const merged = mergeSectionFields(current, draft, ['paymentInformation']);
    expect(merged.name).toBe('Neu (anderer Bereich)');
    expect(merged.paymentInformation?.bankAccount).toBe('DE99');
  });
});

describe('isSectionDirty', () => {
  it('false bei gleichen Werten, true bei Änderung', () => {
    expect(isSectionDirty(company, { ...company }, ['name'])).toBe(false);
    expect(isSectionDirty(company, { ...company, name: 'x' }, ['name'])).toBe(true);
  });

  it('ignoriert Änderungen außerhalb der Bereichsfelder', () => {
    expect(isSectionDirty(company, { ...company, city: 'Andere' }, ['name'])).toBe(false);
  });

  it('vergleicht verschachtelte Objekte inhaltlich', () => {
    const draft = { ...company, paymentInformation: { bankAccount: 'DE00' } };
    expect(isSectionDirty(company, draft, ['paymentInformation'])).toBe(false);
  });
});

describe('pickSectionFields', () => {
  it('liefert nur die angefragten Felder', () => {
    expect(pickSectionFields(company, ['name', 'city'])).toEqual({ name: 'Muster GmbH', city: 'Stadt' });
  });
});
