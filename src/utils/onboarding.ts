import type { PlanFeature } from '../types';

export type OnboardingStepId = 'welcome' | 'firma' | 'zahlung' | 'rechnungen' | 'mahnwesen' | 'email' | 'fertig';

/** Schritte des Einrichtungsassistenten je Rolle und Tarif. Konfigurationsschritte nur für Admins. */
export function getOnboardingSteps(
  admin: boolean,
  hasFeature: (feature: PlanFeature) => boolean
): OnboardingStepId[] {
  if (!admin) return ['welcome', 'fertig'];
  return [
    'welcome',
    'firma',
    'zahlung',
    'rechnungen',
    ...(hasFeature('reminders') ? (['mahnwesen'] as const) : []),
    ...(hasFeature('email') ? (['email'] as const) : []),
    'fertig',
  ];
}

export interface DemoTourStep {
  /** CSS-Selektor des hervorgehobenen Elements; ohne = zentrierter Dialog. */
  selector?: string;
  title: string;
  description: string;
}

export const DEMO_TOUR_STEPS: DemoTourStep[] = [
  {
    title: 'Willkommen in der OpenBills-Demo',
    description: 'In wenigen Schritten zeigen wir Ihnen die wichtigsten Bereiche. Sie können die Tour jederzeit beenden – alle Daten sind Beispieldaten.',
  },
  { selector: '[data-tour="nav-dashboard"]', title: 'Dashboard', description: 'Überblick über Umsätze, offene Rechnungen und anstehende Aufgaben.' },
  { selector: '[data-tour="nav-customers"]', title: 'Kunden', description: 'Kundenstamm mit Adressen, E-Mail-Adressen und kundenspezifischen Konditionen.' },
  { selector: '[data-tour="nav-invoices"]', title: 'Rechnungen', description: 'Rechnungen erstellen, versenden und als PDF, ZUGFeRD oder XRechnung herunterladen.' },
  { selector: '[data-tour="nav-quotes"]', title: 'Angebote', description: 'Angebote schreiben und per Klick in eine Rechnung umwandeln.' },
  { selector: '[data-tour="nav-jobs"]', title: 'Aufträge', description: 'Arbeitszeiten und Material erfassen und daraus Rechnungen erzeugen.' },
  { selector: '[data-tour="nav-calendar"]', title: 'Kalender', description: 'Aufträge und Termine in der Kalenderansicht planen.' },
  { selector: '[data-tour="nav-reporting"]', title: 'Reporting', description: 'Auswertungen zu Umsatz, Kunden und Zahlungseingängen.' },
  { selector: '[data-tour="nav-reminders"]', title: 'Mahnwesen', description: 'Überfällige Rechnungen erkennen und Zahlungserinnerungen in drei Stufen versenden.' },
  { selector: '[data-tour="nav-settings"]', title: 'Einstellungen', description: 'Firmenprofil, Zahlungsdaten, Nummernkreise, Mahnwesen, E-Mail und Benutzer konfigurieren.' },
  {
    title: 'Viel Spaß beim Ausprobieren!',
    description: 'Die Demo wird regelmäßig zurückgesetzt. E-Mails werden nicht wirklich versendet.',
  },
];
