# Einstellungen: Seitenleiste + Bereiche mit eigenem Speichern

## Intent

`src/components/Settings.tsx` (~1700 Zeilen) ist eine lange Seite mit einem Speichern-Button für alles; E-Mail und Backup öffnen sich als Overlays. Das ist unübersichtlich und man speichert ungewollt Änderungen anderer Sektionen mit. Ziel: Einstellungen in klar getrennte Bereiche aufteilen, jeder mit eigenem Speichern, schnell navigierbar.

## Goals

- Layout „Seitenleiste + Inhalt“ (Variante C aus dem Brainstorming).
- Jeder Bereich eigene Hash-Adresse, eigenes Speichern.
- Mobil nutzbar.

## Non-Goals

- Keine neuen Einstellungen, keine geänderten Felder/Validierungen/Texte (außer Bereichsnamen und Speichern-Leiste).
- Keine Backend-Änderungen.
- Kein Umbau von `BackupManagement`, `EmailManagement`, `UserManagement`, `AuditLogView` im Inneren – außer der für die Einbettung nötigen Änderung (s. u.).

## Anti-Goals

- Speichern in Bereich X überschreibt Felder aus Bereich Y (z. B. mit veraltetem Stand).
- Ungespeicherte Änderungen gehen beim Bereichswechsel kommentarlos verloren.

## Approaches

1. **Hülle + eine Komponente pro Bereich (gewählt).** `Settings.tsx` wird zur Hülle (Leiste, Routing), Bereiche in `src/components/settings/`. Jeder Bereich hält eigenen Formular-Zustand und speichert nur seine Felder.
2. Alles in `Settings.tsx` lassen, Sektionen nur ein-/ausblenden. Verworfen: gemeinsamer `formData` macht getrenntes Speichern fummelig, Datei bleibt riesig.

## Design

### Bereiche (Rubrik → Bereich → Inhalt heute)

| Rubrik | Bereich | Hash | Inhalt (bestehende Sektionen) | Speichern |
|---|---|---|---|---|
| Firma | Firmenprofil | `firmenprofil` | Firmendaten, Kontaktdaten | Button |
| Firma | Erscheinungsbild | `erscheinungsbild` | Firmenlogo, Firmen-Icon, Farbschema | Button |
| Firma | Zahlung | `zahlung` | Zahlungsinformationen | Button |
| Dokumente | Rechnungen | `rechnungen` | Rechnungseinstellungen, Sprache und Formatierung | Button |
| Dokumente | Nummernkreise | `nummernkreise` | Rechnungsnummern (jährliche Startnummern) | sofort (wie heute) |
| Dokumente | eRechnung | `erechnung` | eRechnung Einstellungen | Button |
| Dokumente | Mahnwesen | `mahnwesen` | Zahlungserinnerungen Konfiguration | Button |
| Dokumente | Leistungen | `leistungen` | Positionsverwaltung (Stundensätze, Material, Modals, Erweiterte Dropdown-Anzeige) | sofort |
| System | Module | `module` | Module | Button |
| System | E-Mail | `email` | `EmailManagement` eingebettet | wie Komponente heute |
| System | Benutzer | `benutzer` | `UserManagement` (nur Admin) | wie heute |
| System | Backup | `backup` | `BackupManagement` eingebettet | wie heute |
| System | Audit-Log | `audit` | `AuditLogView` (Sichtbarkeit wie heute) | – |

Sichtbarkeitsregeln (Admin-Rolle, `hasFeature`, `PlanLockedNotice`) bleiben exakt wie heute; Bereiche, die heute nicht sichtbar wären, erscheinen auch nicht in der Leiste.

### Navigation / Routing

- Hash `#settings/<bereich>`. `#settings` ohne Bereich → `firmenprofil` (auf Desktop) bzw. Kachelliste (mobil).
- Unbekannter Bereich → `firmenprofil`.
- App-Routing in `App.tsx` splittet Hash bereits in `page/filter/...`; der zweite Teil wird als Bereich an `Settings` gegeben. Bestehende Links/Redirects auf `settings` funktionieren weiter.
- Desktop (≥ lg): Leiste links fest (Rubrik-Überschriften + Einträge), Inhalt rechts.
- Mobil (< lg): `#settings` zeigt Bereiche als Kachelliste nach Rubrik; `#settings/<bereich>` zeigt nur den Bereich mit „← Einstellungen“ oben.

### Speichern

- Bereiche mit Button: eigener lokaler Zustand, initialisiert aus `company`. „Speichern“ nur aktiv bei Änderung (dirty), daneben „Verwerfen“.
- Gespeichert wird `updateCompany({ ...company, ...bereichsFelder })` – also aktueller Kontext-Stand plus nur die Felder dieses Bereichs. Damit überschreibt ein Bereich nie Felder eines anderen.
- Speichern-Leiste zeigt Rückmeldung: kurz „Gespeichert“ bei Erfolg, „Speichern fehlgeschlagen“ bei Fehler (heute gibt es keine sichtbare Meldung). *(Builder-Check, eigene Entscheidung)*
- Wechsel des Bereichs (Leiste, Zurück-Button, Hash) mit dirty Zustand → Bestätigung „Ungespeicherte Änderungen verwerfen?“ (`ConfirmationModal`). Abbrechen bleibt im Bereich. Verlassen der Einstellungsseite ganz: gleiche Abfrage, soweit mit Hash-Routing machbar (siehe Offen für Builder).
- Favicon/Seitentitel-Sofortvorschau (Icon-Upload, Firmenname) verhält sich wie heute; bei „Verwerfen“ wird die Vorschau auf den gespeicherten Stand zurückgesetzt.

### Sonderfälle *(nach Builder-Check, eigene Entscheidungen)*

- **E-Mail/Backup einbetten:** `EmailManagement` und `BackupManagement` haben heute einen Vollbild-Modal-Wrapper als äußerstes Element. Sie bekommen eine Prop `embedded`, die Wrapper, `max-h`-Begrenzung und Schließen-Button weglässt. Ohne Prop unverändert. Die heutigen Info-Karten, die die Overlays öffnen („Features“, „Wichtige Hinweise“), werden zu kurzem Einleitungstext oberhalb der eingebetteten Komponente.
- **Mahnwesen-Sichtbarkeit:** Eintrag „Mahnwesen“ immer in der Leiste. Ist im gespeicherten Stand `remindersEnabled` aus, zeigt der Bereich nur den Hinweis „Zahlungserinnerungen sind deaktiviert – unter Module aktivieren“ mit Link `#settings/module`. Gleiches Muster für andere Bereiche, die heute von einem Modul-Schalter abhängen.
- **`showCombinedDropdowns`** („Erweiterte Dropdown-Anzeige“) bleibt in Leistungen und speichert sofort beim Umschalten – damit ist Leistungen durchgängig „sofort speichern“, ohne Speichern-Leiste.
- Benutzer-Bereich: `Settings` wird ohnehin nur für Admins gerendert (`App.tsx`), keine zusätzliche Rollenprüfung nötig.

### Code-Struktur

- `src/components/Settings.tsx`: Hülle, Bereichsliste (Konfig-Array: id, Rubrik, Label, Icon, sichtbar?), Leiste, mobile Kachelliste, Dirty-Guard.
- `src/components/settings/<Bereich>Section.tsx`: je Bereich. Gemeinsame Speichern-Leiste als kleine Komponente in diesem Ordner.
- Die heute in `Settings.tsx` liegenden Modals (Stundensatz, Materialvorlage) wandern mit in `LeistungenSection`.
- Bestehendes Styling (Tailwind, `text-primary-custom`, Karten-Optik) übernehmen.

## Constraints

- UI-Text Deutsch. Strict TS (`noUnusedLocals` etc.). Kein react-router.
- Tests: Vitest im Frontend (`src/**/__tests__`), läuft in Docker.

## Testen

- Unit: Bereichs-Speichern merged nur eigene Felder; Dirty-Guard; Hash→Bereich-Auflösung inkl. Fallback.
- Manuell: jeder Bereich speichert, Sichtbarkeit je Rolle/Tarif unverändert, mobil Kachelliste.

## Für den Builder offen

- Genaue Feld-Zuordnung je Bereich aus dem bestehenden JSX ableiten (Tabelle oben ist die Gruppierung).
- Dirty-Guard beim Verlassen der Settings-Seite über die Hauptnavigation: wenn ohne größeren Umbau von `App.tsx` nicht sauber machbar, nur Bereichswechsel absichern.
