# Rebranding Belego → OpenBills

Datum: 2026-11-13 · Status: Entwurf zur Freigabe

## Intent

Das Projekt heißt ab jetzt **OpenBills** (Domain `openbills.de` ist registriert). Die Umbenennung ist vollständig: kein „Belego“/„belego“/„BELEGO“ bleibt im Repo-Inhalt — weder in der UI noch in Docker-Bezeichnern, Env-Vars, Doku oder Lizenz. Dazu ein neues Logo und neue Screenshots.

## Ziele

- Jede Erwähnung von Belego im Repo ersetzt (UI, Backend, Skripte, Docker, Doku, LICENSE, Tests, `package.json`/Lockfiles).
- Neues Logo (Variante A, siehe unten) als SVG-Quelle + PNG-Exporte; ersetzt die alten Assets.
- Demo-Instanz mit realistischen Daten, damit der Nutzer die 8 README-Screenshots neu aufnehmen kann.
- Kurze Umzugsanleitung für die bestehende Prod-Instanz im README.

## Non-Goals

- **Kein Migrationscode** für bestehende Instanzen (harter Schnitt). `test`/`test02` sind Spielwiese; die einzige Prod-Instanz (anderer Server) zieht per In-App-Backup → neue Instanz → Restore um.
- **Landingpage** (`Projects/Belego-Landing`) — eigener zweiter Schritt, eigenes Repo.
- **GitHub-Repo umbenennen** (`jnamyslo/Belego` → `jnamyslo/OpenBills`) macht der Nutzer selbst in GitHub. Der Code verweist bereits auf die neue URL; GitHub leitet die alte weiter.
- Git-History wird nicht umgeschrieben. Lokaler Ordnername `Projects/Belego` bleibt Sache des Nutzers.
- Kein Logo-Austausch in bestehenden Datenbanken (Firmenlogo ist Nutzerdaten).

## Anti-Goals

- Ein Mischzustand in `main` (Code sagt OpenBills, README zeigt Belego-Bilder).
- Stilles Weiterlesen alter Namen (`BELEGO_PLAN`-Fallback o. ä.) — widerspricht „wirklich alles“.

## Approaches

1. **Alles in einem Branch/PR** (gewählt): Code, Infra, Doku, Logo, Demo-Daten, danach Screenshots in denselben Branch. `main` springt atomar von Belego auf OpenBills.
2. Zwei PRs (Code zuerst, Screenshots später): kleiner reviewbar, aber Zwischenzustand mit alten Bildern im README. Verworfen.
3. Übergangsphase mit Fallback auf alte Env-Vars/Volumes: risikoärmer für Bestand, widerspricht aber dem vollständigen Rebranding und ist bei nur einer Prod-Instanz unnötig. Verworfen.

## Namensschema

| Kontext | Alt | Neu |
|---|---|---|
| Produktname (Text) | Belego | OpenBills |
| Technischer Slug (Container, Compose-Projekt, Volumes, Netzwerk, npm-Name, Event-Prefix) | `belego` | `openbills` |
| DB-Name / DB-User | `belego_<name>`, Default `belego` | `openbills_<name>`, Default `openbills` |
| Default-DB-Passwort in `docker-compose.yml` | `belego123` | `openbills123` |
| Env-Vars | `BELEGO_PLAN`, `BELEGO_UPGRADE_CONTACT` | `OPENBILLS_PLAN`, `OPENBILLS_UPGRADE_CONTACT` |
| Frontend-Event | `belego:plan-error` | `openbills:plan-error` |
| npm-Pakete | `belego`, `belego-backend` | `openbills`, `openbills-backend` |
| GitHub-URLs | `github.com/jnamyslo/Belego` | `github.com/jnamyslo/OpenBills` |
| Logo-Dateien | `backend/assets/Belego.png`, `Belego_Icon.png` | `backend/assets/OpenBills.png`, `OpenBills_Icon.png` (+ `.svg`-Quellen) |

Groß-/Kleinschreibung: „OpenBills“ in Fließtext und UI, `openbills` in allen technischen Bezeichnern, `OPENBILLS_` für Env-Vars.

## Betroffene Stellen (Stand Bestandsaufnahme)

- **Frontend:** `src/components/Layout.tsx` (Header), `index.html` (Title, Meta, Favicon), `src/utils/faviconUtils.ts` (Manifest-Name, Basistitel, application-name), `src/components/EmailManagement.tsx` (Placeholder), `src/services/api.ts` (Event-Name), `src/utils/pdf/zugferdGenerator.ts` (PDF Producer/Creator), `src/utils/pdfGenerator.ts.backup` (mit ersetzen, Datei sonst unverändert).
- **Backend:** `backend/database.js` (Default-Logo-Pfade + Logmeldung), `routes/emailManagement.js` (Test-Mail-Betreff/-Text, Default-Absendername), `routes/backup.js` (Backup-Name), `utils/plan.js` + `utils/draftWatermark.js` (Env-Var-Namen, Kommentare), `tests/plan.test.js` + `tests/libraries.test.js`, `package.json`.
- **Infra:** `docker-compose.yml`, `deploy-instance.sh`, `manage-instances.sh`.
- **Doku:** `README.md`, `LICENSE` (Projektname im Zusatztext; AGPL-Text selbst unverändert; Copyright-Zeile siehe „Absender“), `CLAUDE.md`, `AGENTS.md`, `docs/CODE_REVIEW.md`, `docs/superpowers/specs/*`, `docs/superpowers/plans/*`.
- **Lockfiles:** `package-lock.json`, `backend/package-lock.json` — nur das `name`-Feld, per `npm install --package-lock-only` in Docker regenerieren statt von Hand.
- Abschlusskriterium: `git grep -i belego` liefert **keine** Treffer (Ausnahme: dieses Spec-Dokument selbst, das den alten Namen bewusst nennt, und die Umzugsanleitung im README).

## Logo (Variante A „Offenes Dokument“)

- Dokument-Umriss mit Eselsohr, Strich, unten links offen; drei Textzeilen; grüner Kreis mit weißem Haken unten rechts überlappend.
- Farben: Navy `#1B1446`, Grün `#1BA085`, Weiß.
- Schriftzug „Open“ Navy + „Bills“ Grün, fett (800), leicht negatives Letter-Spacing. Im finalen SVG als Pfade (keine Abhängigkeit von installierten Fonts).
- Quelle der Geometrie: das gewählte Mockup (Symbol `iconA` in `.superpowers/brainstorm/…/logo-varianten.html`). Wird 1:1 übernommen und nur feinjustiert (Strichstärken, Abstände bei 16 px), nicht neu gezeichnet. Wird ins Repo kopiert, bevor `.superpowers/` ignoriert wird.
- Zusätzlich Dunkel-Variante `OpenBills_dark.svg`/`.png` (Navy → Weiß) für das README via `<picture>` mit `prefers-color-scheme` (GitHub Dark Mode). Claudes Entscheidung.
- Dateien in `backend/assets/`:
  - `OpenBills.svg` / `OpenBills.png` — Icon + Schriftzug, transparent, Breite ~1200 px (ersetzt `Belego.png`; wird als Default-Firmenlogo in neue DBs geschrieben und im README gezeigt).
  - `OpenBills_Icon.svg` / `OpenBills_Icon.png` — nur Icon, quadratisch 512 px (ersetzt `Belego_Icon.png`; Default-Firmenicon).
- Frontend-Favicon: `public/openbills-icon.png` (Vite kopiert `public/` nach `dist/`). `index.html` verweist bisher auf `/Belego_Icon.png`, das im Build gar nicht existiert — wird dabei mit repariert.
- PNG-Export aus SVG im Docker-Container (z. B. `rsvg-convert` oder `sharp`), nicht auf dem Host.
- Header in `Layout.tsx` zeigt weiterhin Firmenlogo/-icon aus der DB + Text; nur der Text wird „OpenBills“.

## Absender: Namyslo Solutions

OpenBills ist ein Projekt von **Namyslo Solutions** (Schreibweise ohne Bindestrich, `https://namyslo-solutions.de`).

- **Nicht** im Default-Logo `OpenBills.png`/`OpenBills_Icon.png`, nicht im Favicon, nicht in Test-Mails, PDF-Metadaten oder Rechnungen — diese landen bei Kunden der Nutzer.
- Namyslo-Icon: rundes Wirbel-Icon aus `Projects/Website-Namyslo-Solutions/public/logo3.png` (3567 px, transparent außerhalb des Kreises), verkleinert ins Repo als `backend/assets/NamysloSolutions_Icon.png` (128 px) und `public/namyslo-solutions-icon.png` (64 px).
- Zusätzliche Lockup-Variante `backend/assets/OpenBills_by_NamysloSolutions.png` (+ `_dark.png`): Icon + Schriftzug wie oben, darunter klein grau (`#6B7280`, ~13/42 der Schriftzughöhe) die Zeile **„by ⟨Namyslo-Icon⟩ Namyslo Solutions“** — Icon steht zwischen „by“ und „Namyslo Solutions“, Höhe ≈ Zeilenhöhe. Für README-Kopf (statt Standard-Lockup) und spätere Landingpage.
- App: Fußzeile unten in der Seitenleiste (`Layout.tsx`), klein grau: „OpenBills by ⟨Icon 16 px⟩ Namyslo Solutions“, „Namyslo Solutions“ als Link (`https://namyslo-solutions.de`, `target="_blank" rel="noopener noreferrer"`).
- README: Fußzeile „Entwickelt von Namyslo Solutions · namyslo-solutions.de“.
- LICENSE: `Copyright (C) 2025 Namyslo Solutions and OpenBills Contributors`.
- `package.json` (beide): `"author": "Namyslo Solutions (https://namyslo-solutions.de)"`, `"homepage": "https://openbills.de"`.

## Demo-Instanz für Screenshots

- Neue Instanz `demo` via `./deploy-instance.sh demo <ports>` (self-hosted, ohne Plan).
- Seed-Skript `scripts/seed-demo.mjs` (Node, läuft in Docker gegen die API, idempotent genug für einmaligen Lauf): Firma „Muster Handwerk GmbH“ mit OpenBills-Default-Logo, ~6 Kunden, ~12 Rechnungen über die letzten 6 Monate (Entwurf, versendet, bezahlt, überfällig), 3 Angebote, 3 Aufträge mit Zeiterfassung, 1 Mahnung Stufe 1. Alle Daten offensichtlich fiktiv.
- Danach liefert Claude dem Nutzer eine Liste: URL der Demo + pro Screenshot die Ansicht/Hash-Route, ggf. welcher Datensatz geöffnet sein soll, Zielgröße (gleicher Ausschnitt wie bisher, ~3000×1700, Browserfenster ohne Chrome). Dateinamen bleiben gleich: `demo/{Dashboard,Rechnungseditor,Rechnungsversand,Rechnungsdownload,Kundenanlage,Auftragsmanagement,Mahnwesen,Reportingh}.png`. Nutzer legt sie in `demo/` ab, Claude committet.
- Seed-Skript bleibt im Repo (nützlich für künftige Screenshots/Demos).

## Umzug Prod-Instanz (README-Abschnitt)

Ablauf (Claudes Entscheidung): **alte Instanz vorher stoppen**, neue Instanz übernimmt dieselben Ports → kurze Downtime, aber keine Proxy-Änderung. Rollback = alte Container wieder starten.

1. Sicherstellen, dass die alte Instanz auf neuestem Belego-Stand ist (Migrationsstand des Backups muss zum OpenBills-Schema passen; Prod ist laut Nutzer aktuell), dann: Einstellungen → Backup → Vollbackup herunterladen. Ab hier keine Änderungen mehr in der alten Instanz.
2. Eigene Werte aus `.env.backend.<name>` (SMTP, Plan, Upgrade-Kontakt o. ä.) notieren.
3. Alte Instanz stoppen (`./manage-instances.sh stop <name>` mit altem Code oder `docker compose --env-file .env.<name> -f docker-compose.yml stop`).
4. Neuen Code ziehen, `./deploy-instance.sh <name> <gleiche Ports>`; notierte Werte in `.env.backend.<name>` übertragen (`BELEGO_*` → `OPENBILLS_*`), `./manage-instances.sh restart <name>`.
5. In der neuen Instanz: Backup wiederherstellen, prüfen.
6. Aufräumen mit reinem `docker` (der neue `manage-instances.sh` filtert auf `openbills-`): `docker rm belego-<name>-{frontend,backend,db}`, `docker volume rm belego-<name>_postgres_data`, `docker network rm belego-<name>_network`.

Vor dem Merge: einmal ein Backup aus einer Belego-Instanz (`test`) in die OpenBills-Demo-Instanz restoren (Probelauf der Anleitung).

## Verifikation

- Frontend- und Backend-Tests in Docker grün (Kommandos aus CLAUDE.md).
- Frontend-Build inkl. Typecheck-Ratsche grün.
- `git grep -i belego` leer (bis auf genannte Ausnahmen).
- Demo-Instanz startet, Container heißen `openbills-demo-*`, Favicon und Header zeigen OpenBills.
- Test-Mail-Vorschau / ZUGFeRD-PDF-Metadaten zeigen OpenBills.

## Housekeeping

- Lokale Spielwiesen `test`/`test02`: `test` dient als Quelle für den Restore-Probelauf; danach werden beide inkl. Volumes und `.env*`-Dateien gelöscht (vom Nutzer freigegeben).

- `.superpowers/` in `.gitignore` aufnehmen.
- Leerer, ungetrackter Ordner `belego-video/` — nicht im Repo, bleibt unangetastet.

## Dem Builder überlassen

- Konkrete Ports der Demo-Instanz.
- Genaue Demo-Datensätze (Namen, Beträge), solange fiktiv und plausibel.
- Werkzeug für SVG→PNG und Text→Pfad-Umwandlung.
