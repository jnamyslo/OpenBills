import type { Company } from '../../types';

export type SettingsSectionId =
  | 'firmenprofil'
  | 'erscheinungsbild'
  | 'zahlung'
  | 'rechnungen'
  | 'nummernkreise'
  | 'erechnung'
  | 'mahnwesen'
  | 'leistungen'
  | 'module'
  | 'email'
  | 'benutzer'
  | 'backup'
  | 'audit';

export type SettingsGroup = 'Firma' | 'Dokumente' | 'System';

export interface SettingsSectionDef {
  id: SettingsSectionId;
  group: SettingsGroup;
  label: string;
  description: string;
  /** Company-Felder, die dieser Bereich über seine Speichern-Leiste speichert (leer = kein Speichern-Button). */
  fields: (keyof Company)[];
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'firmenprofil',
    group: 'Firma',
    label: 'Firmenprofil',
    description: 'Name, Adresse, Steuerdaten, Kontakt',
    fields: [
      'name', 'companyHeaderTwoLine', 'companyHeaderLine1', 'companyHeaderLine2',
      'address', 'postalCode', 'city', 'country', 'taxId', 'taxIdentificationNumber',
      'email', 'phone', 'website',
    ],
  },
  {
    id: 'erscheinungsbild',
    group: 'Firma',
    label: 'Erscheinungsbild',
    description: 'Logo, Icon, Farben',
    fields: ['logo', 'icon', 'primaryColor', 'secondaryColor'],
  },
  {
    id: 'zahlung',
    group: 'Firma',
    label: 'Zahlung',
    description: 'Kontoinhaber, Bankverbindung, Zahlungsbedingungen',
    fields: ['paymentInformation'],
  },
  {
    id: 'rechnungen',
    group: 'Dokumente',
    label: 'Rechnungen',
    description: 'Zahlungsziel, Sofortzahlung, Zahlenformat',
    fields: ['defaultPaymentDays', 'immediatePaymentClause', 'locale'],
  },
  {
    id: 'nummernkreise',
    group: 'Dokumente',
    label: 'Nummernkreise',
    description: 'Start-Rechnungsnummern je Jahr',
    fields: [],
  },
  {
    id: 'erechnung',
    group: 'Dokumente',
    label: 'eRechnung',
    description: 'ZUGFeRD und XRechnung',
    fields: [],
  },
  {
    id: 'mahnwesen',
    group: 'Dokumente',
    label: 'Mahnwesen',
    description: 'Fristen, Mahngebühren, Mahntexte',
    fields: [
      'reminderDaysAfterDue', 'reminderDaysBetween',
      'reminderFeeStage1', 'reminderFeeStage2', 'reminderFeeStage3',
      'reminderTextStage1', 'reminderTextStage2', 'reminderTextStage3',
    ],
  },
  {
    id: 'leistungen',
    group: 'Dokumente',
    label: 'Leistungen',
    description: 'Stundensätze und Materialvorlagen',
    fields: [],
  },
  {
    id: 'module',
    group: 'System',
    label: 'Module',
    description: 'Aufträge, Angebote, Reporting, Mahnwesen',
    fields: [
      'jobTrackingEnabled', 'reportingEnabled', 'quotesEnabled',
      'discountsEnabled', 'isSmallBusiness', 'remindersEnabled',
    ],
  },
  { id: 'email', group: 'System', label: 'E-Mail', description: 'Versand, SMTP, Historie', fields: [] },
  { id: 'benutzer', group: 'System', label: 'Benutzer', description: 'Zugänge und Rollen', fields: [] },
  { id: 'backup', group: 'System', label: 'Backup', description: 'Sichern und wiederherstellen', fields: [] },
  { id: 'audit', group: 'System', label: 'Audit-Log', description: 'Protokoll sicherheitsrelevanter Aktionen', fields: [] },
];

export const DEFAULT_SECTION: SettingsSectionId = 'firmenprofil';

const SECTION_IDS = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id));

export function resolveSection(raw: string | undefined): SettingsSectionId {
  const id = (raw ?? '').trim().toLowerCase();
  return SECTION_IDS.has(id) ? (id as SettingsSectionId) : DEFAULT_SECTION;
}

export function getSection(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((s) => s.id === id) as SettingsSectionDef;
}

export function pickSectionFields(company: Company, fields: (keyof Company)[]): Partial<Company> {
  const picked: Partial<Company> = {};
  for (const field of fields) {
    (picked as Record<string, unknown>)[field] = company[field];
  }
  return picked;
}

/** Aktueller Stand plus nur die Bereichsfelder aus dem Entwurf – überschreibt nie andere Bereiche. */
export function mergeSectionFields(current: Company, draft: Company, fields: (keyof Company)[]): Company {
  return { ...current, ...pickSectionFields(draft, fields) };
}

export function isSectionDirty(saved: Company, draft: Company, fields: (keyof Company)[]): boolean {
  return fields.some((field) => JSON.stringify(saved[field] ?? null) !== JSON.stringify(draft[field] ?? null));
}
