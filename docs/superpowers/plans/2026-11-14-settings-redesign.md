# Einstellungen: Seitenleiste + Bereiche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Settings.tsx` (1700 Zeilen, ein Formular) in eine Seitenleisten-Hülle mit 13 Bereichen aufteilen, jeder mit eigener Hash-Adresse und eigenem Speichern.

**Architecture:** Reine Logik (Bereichsliste, Hash-Auflösung, Feld-Merge, Dirty-Vergleich) in `src/components/settings/sections.ts` – testbar in Vitest (`environment: node`, keine React-Tests im Projekt). `Settings.tsx` wird Hülle; jeder Bereich eine Komponente in `src/components/settings/`, deren JSX 1:1 aus dem heutigen `Settings.tsx` übernommen wird.

**Tech Stack:** React 18, TypeScript strict, Tailwind, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-settings-redesign-design.md`

## Global Constraints

- UI-Text Deutsch; Feldlabels/Texte/Validierungen der Bereiche unverändert übernehmen.
- Strict TS: `noUnusedLocals`, `noUnusedParameters`. Kein react-router.
- Keine Backend-Änderungen.
- Hash-Format: `#settings/<bereich>`; Bereichs-IDs exakt: `firmenprofil, erscheinungsbild, zahlung, rechnungen, nummernkreise, erechnung, mahnwesen, leistungen, module, email, benutzer, backup, audit`.
- Rubriken exakt: `Firma`, `Dokumente`, `System`.
- Tests: **FTEST** = im Repo-Root `docker run --rm -v "$PWD":/src:ro node:24-alpine sh -c "mkdir /app && cd /src && tar cf - --exclude=node_modules . | tar xf - -C /app && cd /app && npm ci && npx vitest run --config vitest.config.mjs <file>"`. **BUILD** = `docker compose --env-file .env.<instanz> -f docker-compose.yml build frontend` (ESLint + tsc).

## Review Focus

1. **Speichern in Bereich A nach Speichern in Bereich B** (ohne Reload) → A darf B's frisch gespeicherte Werte nicht mit altem Stand überschreiben. Test in Task 1 (`mergeSectionFields nimmt nur Bereichsfelder`), Umsetzung in Task 2 (Merge auf aktuellen `company` zum Speicherzeitpunkt).
2. **Unbekannter/alter Hash** (`#settings/foo`, `#settings/` , Großschreibung `#settings/Zahlung`) → Fallback `firmenprofil` statt leerer Seite. Test in Task 1.
3. **Browser-Zurück mit ungespeicherten Änderungen** → Abfrage; bei „Abbrechen“ Hash zurück auf aktuellen Bereich. Manuelle Prüfung Task 2.
4. **Icon-Upload, dann Verwerfen** → Favicon zurück auf gespeicherten Stand. Manuelle Prüfung Task 3.
5. **Module „Zahlungserinnerungen“ aus, `#settings/mahnwesen` direkt aufgerufen** → Hinweis + Link, keine Konfig. Manuelle Prüfung Task 4.

---

### Task 1: Bereichs-Logik `sections.ts`

**Files:**
- Create: `src/components/settings/sections.ts`
- Test: `src/components/settings/__tests__/sections.test.ts` — **Achtung:** `vitest.config.mjs` include ist `src/**/__tests__/**/*.test.ts`, passt.

**Interfaces:**
- Produces:
  - `type SettingsSectionId = 'firmenprofil' | … | 'audit'` (13 IDs oben)
  - `type SettingsGroup = 'Firma' | 'Dokumente' | 'System'`
  - `interface SettingsSectionDef { id: SettingsSectionId; group: SettingsGroup; label: string; description: string; fields: (keyof Company)[] }` (Icon wird in `Settings.tsx` per ID gemappt, damit `sections.ts` React-frei bleibt)
  - `SETTINGS_SECTIONS: SettingsSectionDef[]` in Leisten-Reihenfolge der Spec-Tabelle; Labels: Firmenprofil, Erscheinungsbild, Zahlung, Rechnungen, Nummernkreise, eRechnung, Mahnwesen, Leistungen, Module, E-Mail, Benutzer, Backup, Audit-Log. `fields` = Company-Keys des Bereichs (leer für Sofort-Speichern-/eingebettete Bereiche). Zuordnung aus heutigem JSX ableiten (Sektion → `formData.<key>`).
  - `DEFAULT_SECTION: SettingsSectionId = 'firmenprofil'`
  - `resolveSection(raw: string | undefined): SettingsSectionId` – lowercase, unbekannt/leer → `DEFAULT_SECTION`
  - `pickSectionFields(company: Company, fields: (keyof Company)[]): Partial<Company>`
  - `mergeSectionFields(current: Company, draft: Partial<Company>, fields: (keyof Company)[]): Company` – `{ ...current, ...nur fields aus draft }`
  - `isSectionDirty(saved: Company, draft: Partial<Company>, fields: (keyof Company)[]): boolean` – Feldvergleich per `JSON.stringify` je Feld (Objekte/Arrays wie Mahnstufen)

- [ ] **Step 1: Failing tests**

```ts
describe('resolveSection', () => {
  it('kennt alle 13 Bereiche', () => expect(SETTINGS_SECTIONS.map(s => s.id)).toHaveLength(13));
  it('löst gültige IDs auf, case-insensitiv', () => expect(resolveSection('Zahlung')).toBe('zahlung'));
  it('Fallback bei leer/unbekannt', () => {
    expect(resolveSection(undefined)).toBe('firmenprofil');
    expect(resolveSection('')).toBe('firmenprofil');
    expect(resolveSection('foo')).toBe('firmenprofil');
  });
});
describe('Feldzuordnung', () => {
  it('kein Company-Feld gehört zu zwei Bereichen', () => {
    const all = SETTINGS_SECTIONS.flatMap(s => s.fields);
    expect(new Set(all).size).toBe(all.length);
  });
  it('showCombinedDropdowns liegt nicht in einem Button-Bereich', () =>
    expect(SETTINGS_SECTIONS.flatMap(s => s.fields)).not.toContain('showCombinedDropdowns'));
});
describe('mergeSectionFields', () => {
  it('nimmt nur Bereichsfelder aus dem Entwurf', () => {
    const current = { ...defaultCompany, name: 'Neu (anderer Bereich)', iban: 'DE00' };
    const draft = { name: 'Alt', iban: 'DE99' };
    const merged = mergeSectionFields(current, draft, ['iban']);
    expect(merged.name).toBe('Neu (anderer Bereich)');
    expect(merged.iban).toBe('DE99');
  });
});
describe('isSectionDirty', () => {
  it('false bei gleichen Werten, true bei Änderung', () => {
    expect(isSectionDirty(defaultCompany, { name: defaultCompany.name }, ['name'])).toBe(false);
    expect(isSectionDirty(defaultCompany, { name: 'x' }, ['name'])).toBe(true);
  });
});
```

(`defaultCompany` aus `src/context/CompanyContext.tsx` – falls der Import React zieht und in `node` bricht, minimales `Company`-Fixture im Test anlegen. Feldnamen `iban`/`name` an tatsächliche `Company`-Keys anpassen.)

- [ ] **Step 2: FTEST `src/components/settings/__tests__/sections.test.ts`** → FAIL (Modul fehlt)
- [ ] **Step 3: `sections.ts` implementieren** (Interfaces oben)
- [ ] **Step 4: FTEST** → PASS
- [ ] **Step 5: Commit** `feat(settings): section model for split settings`

---

### Task 2: Hülle `Settings.tsx` – Leiste, Mobil-Kacheln, Routing, Dirty-Guard, Speichern-Leiste

**Files:**
- Modify: `src/components/Settings.tsx` (wird Hülle)
- Create: `src/components/settings/LegacySettings.tsx` (Übergang, siehe Hinweis)
- Modify: `src/App.tsx:249-250` – `<Settings section={currentPageState.filter} onNavigate={(s) => handlePageChange('settings', s)} />`
- Create: `src/components/settings/SaveBar.tsx`
- Create: `src/components/settings/useSectionForm.ts`

> Hinweis Reihenfolge: Damit jede Task baut, legt Task 2 die Hülle an und rendert für Bereiche, die noch nicht extrahiert sind, das bisherige JSX unverändert über eine Übergangs-Komponente `src/components/settings/LegacySettings.tsx` (die alte Datei 1:1 umbenannt, mit Prop `only?: SettingsSectionId` die nur die zugehörigen Karten rendert). Task 3–5 ersetzen Bereich für Bereich; Task 5 löscht `LegacySettings.tsx`.

**Interfaces:**
- Consumes: Task 1 (`SETTINGS_SECTIONS`, `resolveSection`, `mergeSectionFields`, `isSectionDirty`, `pickSectionFields`)
- Produces:
  - `Settings({ section?: string; onNavigate: (id: SettingsSectionId) => void })`
  - `useSectionForm(fields: (keyof Company)[]): { draft: Partial<Company>; setField: <K extends keyof Company>(k: K, v: Company[K]) => void; setDraft: Dispatch<SetStateAction<Partial<Company>>>; dirty: boolean; saving: boolean; status: 'idle' | 'saved' | 'error'; save: () => Promise<void>; discard: () => void }` – initialisiert aus `useCompany().company`, `save` ruft `updateCompany(mergeSectionFields(company, draft, fields))` mit dem **zum Speicherzeitpunkt** aktuellen `company`; re-initialisiert Draft, wenn `company` sich ändert und Bereich nicht dirty ist.
  - `SaveBar({ dirty, saving, status, onSave, onDiscard })` – Buttons „Verwerfen“ / „Speichern“ (disabled wenn !dirty || saving); Status-Text „Gespeichert“ (nach 3 s weg) bzw. „Speichern fehlgeschlagen“.
  - Dirty-Registrierung: React-Context `SettingsDirtyContext` in `Settings.tsx` mit `setDirty(id, boolean)`; Bereiche melden `dirty` aus `useSectionForm`.

- [ ] **Step 1: Hülle bauen**
  - Desktop (`lg:`): `flex`; Leiste `w-60` links, gruppiert nach Rubrik (kleine Uppercase-Überschrift), aktiver Eintrag hervorgehoben (`bg-primary-custom/10`, `text-primary-custom` o. ä. bestehender Stil); rechts Bereichs-Inhalt mit Titel.
  - Mobil (< `lg`): `section` undefined → Kachelliste je Rubrik (Icon, Label, `description`); `section` gesetzt → nur Bereich + Link „← Einstellungen“ (`window.location.hash = 'settings'`).
  - Sichtbarkeit: `benutzer`/`audit` nach den heutigen Bedingungen aus `Settings.tsx` (Feature-Checks/`PlanLockedNotice` übernehmen).
  - Navigation via `onNavigate(id)`. Ist ein Bereich dirty: `ConfirmationModal` „Ungespeicherte Änderungen verwerfen?“; Abbrechen bleibt.
  - Hash-Wechsel von außen (Browser-Zurück) bei dirty: Abfrage; Abbrechen setzt Hash per `history.replaceState` zurück auf aktuellen Bereich.
- [ ] **Step 2: `useSectionForm` + `SaveBar` implementieren**
- [ ] **Step 3: BUILD** → ohne ESLint-/TS-Fehler
- [ ] **Step 4: Manuell:** `#settings` (Desktop → Firmenprofil), `#settings/zahlung`, `#settings/foo` → Firmenprofil; mobil Kachelliste.
- [ ] **Step 5: Commit** `feat(settings): sidebar shell with per-section routing`

---

### Task 3: Firma-Bereiche (Firmenprofil, Erscheinungsbild, Zahlung)

**Files:**
- Create: `src/components/settings/FirmenprofilSection.tsx`, `ErscheinungsbildSection.tsx`, `ZahlungSection.tsx`
- Modify: `src/components/Settings.tsx` (Bereiche einhängen), `LegacySettings.tsx` (Karten entfernen)

**Interfaces:** Consumes `useSectionForm(SETTINGS_SECTIONS.find(id).fields)`, `SaveBar`.

- [ ] **Step 1:** JSX der Karten „Firmendaten“ + „Kontaktdaten“ → Firmenprofil; „Firmenlogo“ + „Firmen-Icon“ + „Farbschema“ → Erscheinungsbild; „Zahlungsinformationen“ → Zahlung. `formData`/`setFormData` → `draft`/`setField`. Logo/Icon-Handler (`handleLogoUpload` etc.) wandern mit.
- [ ] **Step 2:** Erscheinungsbild-`discard` setzt Favicon via `updateFavicon(company.icon ?? null)` zurück; Seitentitel-Vorschau analog (`updatePageTitle`) falls heute im Firmenprofil genutzt.
- [ ] **Step 3: BUILD** grün
- [ ] **Step 4: Manuell:** In jedem Bereich ändern → Speichern aktiv → speichern → „Gespeichert“; Reload zeigt Wert. Firmenname ändern+speichern, dann in Zahlung IBAN speichern → Firmenname bleibt (Review Focus 1). Icon hochladen → Verwerfen → altes Favicon (Review Focus 4).
- [ ] **Step 5: Commit** `feat(settings): company sections with own save`

---

### Task 4: Dokumente-Bereiche (Rechnungen, Nummernkreise, eRechnung, Mahnwesen, Leistungen)

**Files:**
- Create: `src/components/settings/RechnungenSection.tsx`, `NummernkreiseSection.tsx`, `ERechnungSection.tsx`, `MahnwesenSection.tsx`, `LeistungenSection.tsx`
- Modify: `Settings.tsx`, `LegacySettings.tsx`

- [ ] **Step 1:** Rechnungen = „Rechnungseinstellungen“ + „Sprache und Formatierung“ (SaveBar). eRechnung = „eRechnung Einstellungen“ (SaveBar). Mahnwesen = „Zahlungserinnerungen Konfiguration“ (SaveBar).
- [ ] **Step 2:** Nummernkreise = „Rechnungsnummern“ mit dem bestehenden Sofort-Speichern (`loadYearlyStartNumbers` etc. wandern mit), keine SaveBar.
- [ ] **Step 3:** Leistungen = „Positionsverwaltung“ inkl. `HourlyRateModal`/`MaterialTemplateModal` (aus `Settings.tsx` unten) und Feature-Gate `customerPricing`. Toggle „Erweiterte Dropdown-Anzeige“ speichert sofort: `updateCompany({ ...company, showCombinedDropdowns: v })`; Fehler → Toggle zurück + Text „Speichern fehlgeschlagen“.
- [ ] **Step 4:** Mahnwesen: wenn gespeichertes `company.remindersEnabled` falsy → nur Hinweis „Zahlungserinnerungen sind deaktiviert – unter Module aktivieren.“ mit Link auf `onNavigate('module')`. Feature-Gate `reminders` wie heute.
- [ ] **Step 5: BUILD** grün; **Manuell:** Review Focus 5; Stundensatz anlegen/bearbeiten/löschen; Startnummer anlegen.
- [ ] **Step 6: Commit** `feat(settings): document sections`

---

### Task 5: System-Bereiche (Module, E-Mail, Benutzer, Backup, Audit-Log) + Aufräumen

**Files:**
- Create: `src/components/settings/ModuleSection.tsx`
- Modify: `src/components/EmailManagement.tsx`, `src/components/BackupManagement.tsx` (Prop `embedded?: boolean`)
- Modify: `Settings.tsx`; Delete: `src/components/settings/LegacySettings.tsx`

**Interfaces:**
- Produces: `EmailManagement({ …bestehende Props, embedded?: boolean })`, `BackupManagement({ …, embedded?: boolean })` – bei `embedded`: kein `fixed inset-0`-Wrapper, keine `max-h`-Begrenzung, kein Schließen-Button; sonst unverändert.

- [ ] **Step 1:** Module = Karte „Module“ (SaveBar). Nach Speichern reagieren Navigation/Mahnwesen-Hinweis auf gespeicherten Stand.
- [ ] **Step 2:** `embedded`-Prop in beiden Komponenten; Bereiche E-Mail/Backup rendern Einleitungstext (Inhalt der heutigen Info-Karten „Features“/„Wichtige Hinweise“ gekürzt) + Komponente mit `embedded`.
- [ ] **Step 3:** Benutzer → `<UserManagement />`, Audit-Log → `<AuditLogView />` mit heutigen Bedingungen.
- [ ] **Step 4:** `LegacySettings.tsx` löschen; ungenutzte Imports/States in `Settings.tsx` entfernen.
- [ ] **Step 5: BUILD** grün; FTEST gesamt grün.
- [ ] **Step 6: Manuell:** alle 13 Bereiche durchklicken (Desktop + schmales Fenster); E-Mail/Backup ohne Overlay; Module-Schalter speichern → Hauptnavigation passt sich an.
- [ ] **Step 7: Commit** `feat(settings): system sections, embed email/backup`
