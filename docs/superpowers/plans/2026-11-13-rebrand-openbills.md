# Rebranding Belego → OpenBills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projekt vollständig von Belego in OpenBills umbenennen, neues Logo (Variante A), Demo-Instanz mit Daten für neue Screenshots.

**Architecture:** Mechanische Umbenennung über Frontend, Backend, Infra-Skripte und Doku auf Branch `rebrand/openbills`; neue Logo-Assets aus SVG-Quelle; Seed-Skript befüllt eine frische Instanz über die REST-API. Kein Migrationscode (harter Schnitt).

**Tech Stack:** React/Vite/TS, Express (ESM), PostgreSQL, Docker Compose, Bash.

**Spec:** `docs/superpowers/specs/2026-11-13-rebrand-openbills-design.md`

## Global Constraints

- Produktname im Text: `OpenBills`. Technischer Slug: `openbills`. Env-Prefix: `OPENBILLS_`.
- `BELEGO_PLAN` → `OPENBILLS_PLAN`, `BELEGO_UPGRADE_CONTACT` → `OPENBILLS_UPGRADE_CONTACT`. Kein Fallback auf alte Namen.
- Event `belego:plan-error` → `openbills:plan-error`.
- DB-Defaults: Name/User `openbills`, Passwort `openbills123`; pro Instanz `openbills_<name>`.
- GitHub-URLs → `https://github.com/jnamyslo/OpenBills`. Domain `openbills.de`.
- Logo-Farben: Navy `#1B1446`, Grün `#1BA085`. Schriftzug „Open“ Navy + „Bills“ Grün, Gewicht 800.
- Alles in Docker, kein `npm` auf dem Host. Tests: Kommando aus `CLAUDE.md`.
- UI-Texte bleiben Deutsch. Nur Bezeichner/Namen ändern, keine angrenzenden „Verbesserungen“.
- Abschluss: `git grep -i belego` liefert nur Treffer in der Spec, diesem Plan und im README-Abschnitt „Umzug von Belego“.

## Review Focus

1. Ein Restore eines Belego-Backups in eine OpenBills-Instanz muss alle Daten übernehmen (Task 7 Probelauf).
2. `deploy-instance.sh` im Quick-Modus mit Plan-Argument muss `OPENBILLS_PLAN` in `.env.backend.<name>` schreiben, und das Backend muss damit starten (Task 4 Verifikation).
3. Eine alte `.env.backend.<name>` mit nur `BELEGO_PLAN=starter` startet als selfhosted (unlimited) — erwartet und in der Umzugsanleitung (Schritt 4) erwähnt, nicht im Code abgefangen.
4. Favicon muss im gebauten Frontend tatsächlich ausgeliefert werden (`/openbills-icon.png` → 200) (Task 6 Verifikation).
5. Lockfiles: `name`-Feld geändert, sonst keine Abhängigkeitsänderung (`git diff --stat` der Lockfiles klein) (Task 2/3).

---

### Task 1: Logo-Assets

**Files:**
- Create: `backend/assets/OpenBills_Icon.svg`, `backend/assets/OpenBills.svg`, `backend/assets/OpenBills_dark.svg`
- Create (Export): `backend/assets/OpenBills_Icon.png` (512×512), `backend/assets/OpenBills.png` (Breite 1200, transparent), `backend/assets/OpenBills_dark.png`, `public/openbills-icon.png` (Kopie von `OpenBills_Icon.png`)
- Delete: `backend/assets/Belego.png`, `backend/assets/Belego_Icon.png` (erst in Task 3, wenn `database.js` umgestellt ist)

**Interfaces:**
- Produces: Dateinamen oben; Task 3 lädt `./assets/OpenBills.png` und `./assets/OpenBills_Icon.png`, Task 2 referenziert `/openbills-icon.png`, Task 5 referenziert `backend/assets/OpenBills.png` und `OpenBills_dark.png`.

- [ ] **Step 1:** Icon-SVG aus Symbol `iconA` in `.superpowers/brainstorm/82621-1794584159/content/logo-varianten.html` übernehmen (viewBox `0 0 64 64`, `var(--ink)` → `#1B1446`, `var(--accent)` → `#1BA085`). Feinjustage: bei 16 px gerendert muss der Haken erkennbar bleiben.
- [ ] **Step 2:** Lockup-SVG: Icon links, Schriftzug rechts. Text in Pfade umwandeln (z. B. Inter ExtraBold via `opentype.js`/`fonttools` im Container); kein `<text>` im finalen SVG. Dark-Variante: Navy → `#FFFFFF`, Grün unverändert.
- [ ] **Step 2b:** Namyslo-Icon aus `/Users/namysloj/Projects/Website-Namyslo-Solutions/public/logo3.png` verkleinern → `backend/assets/NamysloSolutions_Icon.png` (128 px), `public/namyslo-solutions-icon.png` (64 px). Lockup `OpenBills_by_NamysloSolutions.svg` (+ `_dark`): Standard-Lockup + Zeile darunter „by ⟨Namyslo-Icon⟩ Namyslo Solutions“ in `#6B7280` (dark: `#9CA3AF`), Icon als eingebettetes PNG (`data:` URI), Text als Pfade.
- [ ] **Step 3:** PNG-Export in Docker (z. B. `docker run --rm -v "$PWD":/w -w /w alpine sh -c "apk add rsvg-convert && rsvg-convert …"`).
- [ ] **Step 4: Verifizieren**
  Run: `file backend/assets/OpenBills*.png public/openbills-icon.png && grep -c '<text' backend/assets/*.svg`
  Expected: PNGs mit korrekten Maßen, `<text`-Zähler 0. Bilder per Read-Tool ansehen: Icon 16 px/512 px, Lockup hell/dunkel.
- [ ] **Step 5: Commit** `feat(brand): OpenBills logo assets`

### Task 2: Frontend umbenennen

**Files:**
- Modify: `src/components/Layout.tsx:72`, `index.html:5-15`, `src/utils/faviconUtils.ts:89-209`, `src/components/EmailManagement.tsx:758,850`, `src/services/api.ts:19`, `src/utils/pdf/zugferdGenerator.ts:263-264`, `src/utils/pdfGenerator.ts.backup:889-890`, `package.json:2`, `package-lock.json` (nur `name`)

**Interfaces:**
- Consumes: `/openbills-icon.png` aus Task 1.
- Produces: `PLAN_ERROR_EVENT = 'openbills:plan-error'` (Konsumenten importieren die Konstante, kein String-Literal anfassen — per `grep plan-error src` prüfen).

- [ ] **Step 1:** Alle Vorkommen ersetzen. `index.html`: Favicon/Apple-Touch/msTile → `/openbills-icon.png`, `application-name` und `<title>` → `OpenBills - eRechnung-konforme Rechnungsanwendung` (gleicher String als `baseTitle` in `faviconUtils.ts`). Manifest-Name `${companyName} - OpenBills`. ZUGFeRD Producer/Creator `OpenBills`.
- [ ] **Step 1b:** `Layout.tsx`: Fußzeile unten in der Seitenleiste, `text-xs text-gray-400`: `OpenBills by <img src="/namyslo-solutions-icon.png" class="w-4 h-4 rounded-full inline" alt=""> <a href="https://namyslo-solutions.de" target="_blank" rel="noopener noreferrer">Namyslo Solutions</a>`. `package.json`: `author`, `homepage` laut Spec.
- [ ] **Step 2:** Lockfile regenerieren in Docker: `docker run --rm -v "$PWD":/w -w /w node:24-alpine npm install --package-lock-only --ignore-scripts`
- [ ] **Step 3: Verifizieren**
  Run: `git grep -i belego -- src index.html package.json package-lock.json` → leer. `git diff --stat package-lock.json` → nur wenige Zeilen. Frontend-Tests per CLAUDE.md-Kommando → PASS.
- [ ] **Step 4: Commit** `refactor(frontend): rename Belego to OpenBills`

### Task 3: Backend umbenennen

**Files:**
- Modify: `backend/utils/plan.js:3,44,50,71`, `backend/utils/draftWatermark.js:3`, `backend/database.js:175-176,224`, `backend/routes/emailManagement.js:802-880`, `backend/routes/backup.js:654`, `backend/package.json:2,4`, `backend/package-lock.json` (nur `name`)
- Test: `backend/tests/plan.test.js`, `backend/tests/libraries.test.js:1,43`
- Delete: `backend/assets/Belego.png`, `backend/assets/Belego_Icon.png`

**Interfaces:**
- Consumes: `./assets/OpenBills.png`, `./assets/OpenBills_Icon.png` aus Task 1.
- Produces: `resolvePlanName` wirft `Unbekannter OPENBILLS_PLAN "<v>". Erlaubt: free, starter, professional, enterprise oder leer.`; liest `process.env.OPENBILLS_PLAN`; Upgrade-Kontakt aus `process.env.OPENBILLS_UPGRADE_CONTACT`.

- [ ] **Step 1: Tests anpassen (rot)** — in `plan.test.js` alle `vi.stubEnv('BELEGO_PLAN', …)` → `'OPENBILLS_PLAN'`, Fehler-Regex → `/Unbekannter OPENBILLS_PLAN/`. Zusätzlich:
  ```js
  it('ignoriert den alten BELEGO_PLAN', () => {
    vi.stubEnv('OPENBILLS_PLAN', '');
    vi.stubEnv('BELEGO_PLAN', 'free');
    expect(getPlan().name).toBe('selfhosted');
  });
  ```
  (Funktionsnamen an das anpassen, was `plan.js` tatsächlich exportiert.)
- [ ] **Step 2:** Backend-Tests in Docker → FAIL bei den umgestellten Fällen.
- [ ] **Step 3:** `plan.js`, restliche Backend-Dateien umbenennen. Test-Mail: Betreff `Test-E-Mail von OpenBills`, Text `…von Ihrem OpenBills-System…`, Footer `…von OpenBills generiert.`, Default-Absender `OpenBills`. Backup-Name `OpenBills Vollbackup`. `libraries.test.js`: `from: 'OpenBills <rechnung@example.com>'`. Alte PNGs löschen. Lockfile wie Task 2 Step 2 (im `backend/`).
- [ ] **Step 4:** Backend-Tests → PASS. `git grep -i belego -- backend` → leer.
- [ ] **Step 5: Commit** `refactor(backend): rename Belego to OpenBills, OPENBILLS_* env vars`

### Task 4: Infra-Skripte

**Files:**
- Modify: `docker-compose.yml` (alle `belego`-Defaults → `openbills`, Passwort `openbills123`), `deploy-instance.sh` (Texte, `COMPOSE_PROJECT_NAME=openbills-…`, `POSTGRES_DB`/`DB_NAME=openbills_…`, Variablen `BELEGO_*` → `OPENBILLS_*`), `manage-instances.sh` (Filter `name=openbills-`, `openbills-${instance}-db`, `^OPENBILLS_PLAN=`, Texte)

- [ ] **Step 1:** Ersetzen. Shell-Variablen im Skript ebenfalls umbenennen (`OPENBILLS_PLAN`), damit `git grep` leer bleibt.
- [ ] **Step 2: Verifizieren**
  Run: `bash -n deploy-instance.sh && bash -n manage-instances.sh && docker compose -f docker-compose.yml config | grep -i belego`
  Expected: Syntax ok, grep leer.
- [ ] **Step 3: Commit** `refactor(infra): openbills container, volume and env names`

### Task 5: Doku & Lizenz

**Files:**
- Modify: `README.md`, `LICENSE` (Zusatztext + `Copyright (C) 2025 OpenBills Contributors`, AGPL-Text unverändert), `CLAUDE.md`, `AGENTS.md`, `docs/CODE_REVIEW.md`, `docs/superpowers/specs/2026-11-13-plan-tiers.md`, `docs/superpowers/plans/*.md`, `docs/agents/*.md` (falls Treffer)

- [ ] **Step 1:** Ersetzen. README-Logo:
  ```html
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="backend/assets/OpenBills_dark.png">
    <img src="backend/assets/OpenBills.png" alt="OpenBills Logo" width="400">
  </picture>
  ```
  (dabei `OpenBills_by_NamysloSolutions(.png|_dark.png)` statt Standard-Lockup verwenden). README-Fußzeile „Entwickelt von Namyslo Solutions · https://namyslo-solutions.de“. LICENSE-Copyright `Namyslo Solutions and OpenBills Contributors`. `backend/package.json`: `author`, `homepage` laut Spec.
  Website-Link `https://openbills.de` im Kopf. Clone-Befehl `git clone https://github.com/jnamyslo/OpenBills.git && cd OpenBills`.
- [ ] **Step 2:** README-Abschnitt „Umzug von Belego“ mit den 6 Schritten aus der Spec (Abschnitt „Umzug Prod-Instanz“), inkl. Hinweis: alte `BELEGO_*`-Werte werden nicht mehr gelesen.
- [ ] **Step 3:** `git grep -i belego` → nur Spec + Umzugsabschnitt.
- [ ] **Step 4: Commit** `docs: rebrand to OpenBills`

### Task 6: Demo-Instanz + Seed-Skript

**Files:**
- Create: `scripts/seed-demo.mjs`

**Interfaces:**
- Consumes: REST-API unter `${API_URL}` (Default `http://localhost:<api-port>/api`): `PUT /company`, `POST /customers`, `POST /invoices`, `PUT /invoices/:id`, `POST /quotes`, `POST /jobs`. Body-Formen aus `src/types/index.ts` und `src/services/api.ts`.
- Produces: `node scripts/seed-demo.mjs <apiUrl>` — Node ≥ 24 `fetch`, keine Dependencies.

- [ ] **Step 1:** Freie Ports prüfen (`.env.test*` lesen, `lsof -i`), Demo deployen: `./deploy-instance.sh demo <db> <api> <web>`.
- [ ] **Step 2: Verifizieren** `docker ps --format '{{.Names}}' | grep openbills-demo` → 3 Container; `curl -s -o /dev/null -w '%{http_code}' http://localhost:<web>/openbills-icon.png` → `200`; Header zeigt OpenBills.
- [ ] **Step 3:** Skript schreiben: Firma „Muster Handwerk GmbH“ (Logo nicht anfassen → Default-OpenBills), 6 Kunden, 12 Rechnungen über die letzten 6 Monate (3 Entwurf, 3 versendet, 4 bezahlt, 2 überfällig, davon 1 mit Mahnstufe 1 per `PUT` der Rechnungsfelder — **keine** E-Mail auslösen), 3 Angebote, 3 Aufträge mit Zeiteinträgen. Rechnungen per normalem Create mit festem Status anlegen, wie das Frontend es tut.
- [ ] **Step 4:** In Docker gegen Demo laufen lassen: `docker run --rm --network host -v "$PWD/scripts":/s:ro node:24-alpine node /s/seed-demo.mjs http://localhost:<api>/api`. Dashboard zeigt Zahlen ≠ 0, Reporting zeigt Monatsumsätze.
- [ ] **Step 5: Commit** `chore: demo seed script for screenshots`

### Task 7: Restore-Probelauf + Aufräumen

- [ ] **Step 1:** Laufende `belego-test`: ZIP-Backup per `POST /api/backup/…` (Endpunkt wie Frontend `createZipBackup`) ziehen; Anzahl Kunden/Rechnungen notieren.
- [ ] **Step 2:** Wegwerf-Instanz `restorecheck` deployen (freie Ports), Backup per Restore-Endpunkt einspielen, Anzahl Kunden/Rechnungen vergleichen → identisch.
- [ ] **Step 3:** Nur nach erfolgreichem Vergleich: `restorecheck` via `./manage-instances.sh remove restorecheck`; alte Spielwiesen mit reinem Docker entfernen: `docker rm -f belego-{test,test02}-{frontend,backend,db}`, `docker volume rm belego-test_postgres_data belego-test02_postgres_data`, `docker network rm belego-test_network belego-test02_network`, `rm .env.test .env.test02 .env.backend.test .env.backend.test02`. `belego-landing` **nicht** anfassen.
- [ ] **Step 4:** Ergebnis (Zahlen) an Nutzer melden. Kein Commit (nur lokale Umgebung).

### Task 8: Screenshot-Übergabe

**Files:**
- Modify: `demo/{Dashboard,Rechnungseditor,Rechnungsversand,Rechnungsdownload,Kundenanlage,Auftragsmanagement,Mahnwesen,Reportingh}.png` (vom Nutzer geliefert)

- [ ] **Step 1:** Jede alte Datei ansehen und dem Nutzer pro Screenshot liefern: Demo-URL + Hash-Route, welcher Datensatz/Dialog offen, Fensterbreite wie bisher (~1500 CSS-px, Retina → ~3000 px).
- [ ] **Step 2:** Nach Ablage der Dateien prüfen (Read-Tool): Header zeigt OpenBills, keine echten Daten.
- [ ] **Step 3: Commit** `docs: new screenshots`
- [ ] **Step 4:** Abschlussprüfung `git grep -i belego`, beide Test-Suites, Frontend-Build. Dann Nutzer: GitHub-Repo umbenennen, PR öffnen (nach Rückfrage).
