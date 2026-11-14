// Demo-Modus (OPENBILLS_DEMO): vom DemoProvider gesetzt, damit auch Nicht-React-Code (alerts) ihn kennt.
let demoMode = false;

export function setDemoMode(value: boolean): void {
  demoMode = value;
}

/** Zusatz für Erfolgsmeldungen beim Mailversand: in der Demo geht keine Mail raus. */
export function demoMailNote(): string {
  return demoMode ? '\n\nDemo: E-Mail wurde nicht wirklich versendet.' : '';
}

export function formatResetTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
