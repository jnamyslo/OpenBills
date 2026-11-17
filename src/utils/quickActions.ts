/**
 * Dashboard-Schnellaktionen springen per Hash `#<seite>/new` direkt in den „Neu“-Dialog.
 * Nach dem Öffnen wird `/new` aus der URL entfernt, damit Neuladen/Zurück den Dialog nicht erneut öffnet.
 */
export function clearCreateRoute(page: string): void {
  window.history.replaceState(null, '', `#${page}`);
}
