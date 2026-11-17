import type { PlanFeature } from '../types';

export type OnboardingStepId = 'welcome' | 'firma' | 'zahlung' | 'rechnungen' | 'mahnwesen' | 'email' | 'fertig';

/** Schritte des Einrichtungsassistenten (nur für Admins) je Tarif. */
export function getOnboardingSteps(hasFeature: (feature: PlanFeature) => boolean): OnboardingStepId[] {
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
  /** Popover-Seite auf dem Desktop (Standard: rechts); mobil immer unten. */
  side?: 'right' | 'bottom';
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
  { selector: '[data-tour="nav-quotes"]', title: 'Angebote', description: 'Angebote schreiben, per Link vom Kunden annehmen lassen und anschließend in einen Auftrag oder eine Rechnung umwandeln.' },
  { selector: '[data-tour="nav-jobs"]', title: 'Aufträge', description: 'Arbeitszeiten und Material erfassen und daraus Rechnungen erzeugen.' },
  { selector: '[data-tour="nav-invoices"]', title: 'Rechnungen', description: 'Rechnungen erstellen, versenden und als PDF, ZUGFeRD oder XRechnung herunterladen.' },
  { selector: '[data-tour="nav-reminders"]', title: 'Mahnwesen', description: 'Überfällige Rechnungen erkennen und Zahlungserinnerungen in drei Stufen versenden.' },
  { selector: '[data-tour="nav-calendar"]', title: 'Kalender', description: 'Aufträge und Termine in der Kalenderansicht planen.' },
  { selector: '[data-tour="nav-reporting"]', title: 'Reporting', description: 'Auswertungen zu Umsatz, Kunden und Zahlungseingängen.' },
  { selector: '[data-tour="nav-settings"]', title: 'Einstellungen', description: 'Firmenprofil, Zahlungsdaten, Nummernkreise, Mahnwesen, E-Mail und Benutzer konfigurieren.' },
  {
    selector: '[data-tour="user-menu"]',
    side: 'bottom',
    title: 'Viel Spaß beim Ausprobieren!',
    description: 'Diese Tour können Sie jederzeit über Ihr Profil oben rechts unter „Demo-Tour“ erneut starten. Die Demo wird regelmäßig zurückgesetzt, E-Mails werden nicht wirklich versendet.',
  },
];

/** Schritte für normale Instanzen: gleiche Navigation, aber Texte ohne Demo-Bezug. */
export function getTourSteps(demo: boolean): DemoTourStep[] {
  if (demo) return DEMO_TOUR_STEPS;
  return DEMO_TOUR_STEPS.map((step, i) => {
    if (i === 0) {
      return {
        ...step,
        title: 'Willkommen bei OpenBills',
        description: 'In wenigen Schritten zeigen wir Ihnen die wichtigsten Bereiche. Sie können die Tour jederzeit beenden.',
      };
    }
    if (step.selector === '[data-tour="user-menu"]') {
      return {
        ...step,
        title: 'Viel Erfolg!',
        description: 'Die Tour können Sie jederzeit über Ihr Profil oben rechts unter „Rundgang“ erneut starten.',
      };
    }
    return step;
  });
}

/** Event an `Layout`: mobiles Seitenmenü für die Demo-Tour öffnen/schließen (detail: boolean). */
export const DEMO_TOUR_MOBILE_NAV_EVENT = 'openbills:demo-tour-mobile-nav';
