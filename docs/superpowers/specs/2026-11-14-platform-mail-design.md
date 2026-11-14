# Plattform-Mailversand für Hosted-Tarife

Stand: 2026-11-14 · Status: Design, freigegeben zur Planung

## Absicht

Hosted-Instanzen (Free, Starter, Professional) sollen Systemmails und teils Kundenmails über den zentralen Brevo-Relay von openbills.de versenden – nicht über eigenes SMTP. Ein eigener Absender wird damit ein Upgrade-Grund:

- Eigener Mailserver für Kundenmails (Rechnung/Angebot/Mahnung) → ab **Professional**.
- Eigener Absender auch für Systemmails (Einladung/Passwort-Reset) → nur **Enterprise**.

Self-Hosted bleibt unverändert: eigenes SMTP, alles erlaubt.

## Matrix

| Tarif | Systemmails (Einladung, PW-Reset) | Kundenmails (Rechnung, Angebot, Mahnung) |
|---|---|---|
| selfhosted | eigenes SMTP (wie heute) | eigenes SMTP (wie heute) |
| free | Plattform, `support@openbills.de` | kein Versand (Feature `email` fehlt, wie heute) |
| starter | Plattform, `support@openbills.de` | Plattform, `<instanz>@openbills.de`, Reply-To = Firmen-E-Mail |
| professional | Plattform, `support@openbills.de` | eigenes SMTP; solange keins aktiviert ist: Plattform wie Starter |
| enterprise | eigenes SMTP | eigenes SMTP |

„Eigenes SMTP" = heutige Logik (`smtp_settings` in DB, Fallback `SMTP_*`-Env).

**Plattform-Tarife** = free, starter, professional. Nur diese bekommen `.env.platform`, die Deploy-Abfrage und die Namensregel. Enterprise nutzt die Plattform nie und bekommt keine Zugangsdaten.

Professional „eigenes SMTP aktiviert" = Zeile in `smtp_settings` mit `is_enabled = true` und `smtp_host`. Sonst (z. B. direkt nach Upgrade von Starter) laufen Kundenmails über die Plattform, damit ein Upgrade nichts kaputt macht.

## Ziele

- Zugangsdaten nie im Repo oder Image (Repo ist öffentlich).
- Pro Host eine zentrale Datei; Key-Rotation = Datei ändern + Instanzen neu starten.
- Backend erzwingt die Matrix; UI ist nur UX.
- Einladungs- und Reset-Mail im Layout der Rechnungsmails.

## Nicht-Ziele / Anti-Ziele

- Kein Lizenz-Key. Schutz entsteht dadurch, dass Self-Hoster die Zugangsdaten nie bekommen.
- Kein stiller Fallback: Eine Hosted-Instanz darf bei fehlenden Plattform-Zugangsdaten **nie** auf Kunden-SMTP ausweichen (sonst ist das Upgrade-Argument umgangen).
- Kein Mailversand für Onboarding (Link wird weiterhin im Terminal ausgegeben).
- Kein separater Brevo-Zugang pro Absender.

## Approaches (betrachtet)

- **A – Abfrage bei jedem Deploy, Werte in `.env.backend.<name>`:** Key N-fach verstreut, Rotation pro Instanz. Verworfen.
- **B – Zentrale `.env.platform` + Compose-Override nur für Hosted-Tarife:** einmal abfragen, Self-Hosted-Instanzen bekommen die Datei nie. **Gewählt.**
- **C – Docker Secrets / Secret-Manager:** für einen Host überdimensioniert. Verworfen.

## Entscheidungen

### Zugangsdaten & Deployment

- Datei `.env.platform` im Repo-Root (bereits durch `.env.*` in `.gitignore` ausgeschlossen), Rechte `600`. Inhalt:
  ```
  PLATFORM_SMTP_HOST=smtp-relay.brevo.com
  PLATFORM_SMTP_PORT=587
  PLATFORM_SMTP_SECURE=false
  PLATFORM_SMTP_USER=...
  PLATFORM_SMTP_PASS=...
  ```
- Neue Datei `docker-compose.platform.yml` (Override) hängt `.env.platform` als zusätzliches `env_file` an den Service `backend`.
- `deploy-instance.sh` und `manage-instances.sh` bekommen eine gemeinsame Hilfslogik, die je Instanz die Compose-Dateien bestimmt: Plan in `.env.backend.<name>` ist free/starter/professional → zusätzlich `-f docker-compose.platform.yml`. Alle bestehenden `docker compose … -f docker-compose.yml`-Aufrufe nutzen diese Logik (Plan-Änderung via `config` + `restart` greift damit automatisch).
- `deploy-instance.sh` bei Plattform-Tarif: fehlt `.env.platform`, interaktiv Host (Default `smtp-relay.brevo.com`), Port (Default 587), User, Key (verdeckte Eingabe) abfragen und Datei anlegen. Existiert sie, keine Nachfrage. Im Legacy/Quick-Modus ohne Datei: Abbruch mit Hinweis.
- Instanzname wird Teil der Absenderadresse → bei Plattform-Tarif nur `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` erlaubt.
- `manage-instances.sh start/restart` (Tarifwechsel via `config`): Plattform-Tarif und `.env.platform` fehlt oder Name verletzt die Regel → Abbruch mit klarer Meldung (keine Abfrage dort). Annahme: noch keine Hosted-Instanzen live, keine Migration nötig.
- Backend bekommt den Instanznamen als `OPENBILLS_INSTANCE` (aus `INSTANCE_NAME` in Compose).

### Backend

- Zentrale Auflösung der Mail-Route, z. B. in `backend/utils/plan.js` oder neuem `backend/services/mailRouting.js`: `getMailRoute('system' | 'customer')` → `{ kind: 'platform', from, replyTo? } | { kind: 'own' }` gemäß Matrix.
- Plattform-Transport aus `PLATFORM_SMTP_*`; eigener Transport = heutiges `createTransporter`/`getSenderInfo`.
- **Startprüfung:** Plan ∈ {free, starter, professional} und `PLATFORM_SMTP_HOST/USER/PASS` oder `OPENBILLS_INSTANCE` fehlen → Backend startet nicht (wie `assertAuthConfig`), klare Fehlermeldung.
- Systemmails (`authMailService.js`): bei Plattform-Route Absender `"OpenBills" <support@openbills.de>`; `isSmtpConfigured()` liefert dann `true`.
- Kundenmails (Rechnung, Rechnung-Multiformat, Angebot, Mahnung in `emailService.js`): bei Plattform-Route Absender `"<Firmenname>" <<instanz>@openbills.de>`, `Reply-To` = Firmen-E-Mail aus den Firmeneinstellungen (fehlt sie: kein Reply-To). E-Mail-Historie speichert den tatsächlich verwendeten Absender.
- `testEmailConnection` testet den Transport der Kundenmail-Route.
- **Tageslimit für Plattform-Kundenmails:** max. **20 pro Tag** (Europe/Berlin) und Instanz. Gezählt werden erfolgreich versendete Einträge der E-Mail-Historie mit Plattform-Absender (`<instanz>@openbills.de`) – keine neue Tabelle. Bei Erreichen: 429, `code: 'PLATFORM_MAIL_LIMIT'`, deutsche Meldung inkl. Upgrade-Kontakt; Frontend zeigt sie wie andere Plan-Fehler. Systemmails zählen nicht (Reset hat bereits Rate-Limit). Begründung: Starter hat max. 25 Rechnungen + 25 Angebote/Monat; Limit schützt Brevo-Account und Domain-Reputation. Wert als Konstante, nicht konfigurierbar.
- **SMTP-Admin-Endpunkte** `send-test-email`, `test-smtp`, `diagnose-smtp`, `debug-config`, `test-network`: bei Free und Starter 403 (`FEATURE_NOT_IN_PLAN`-Stil) – sonst ließe sich über Backup-Restore eigenes SMTP nutzen bzw. Freitext über openbills.de senden. Bei Professional, Enterprise, Self-Hosted unverändert.
- SMTP-Einstellungen (`/api/email-management/smtp-settings`): bei Free und Starter schreibt `POST` mit 403 (`FEATURE_NOT_IN_PLAN`-Stil) ab; `GET` liefert zusätzlich, welche Route gilt. Bei Professional bleibt Speichern erlaubt (betrifft nur Kundenmails). DB-Werte aus Backup-Restore werden bei Plattform-Route schlicht ignoriert.
- `GET /api/plan` liefert die Mail-Routen mit, damit das Frontend sie anzeigen kann.

### Frontend (`EmailManagement.tsx`)

- Free/Starter: SMTP-Formular ausgeblendet; Hinweis „Versand über OpenBills · eigener Mailserver ab Professional" (+ Upgrade-Kontakt, falls gesetzt).
- Professional: Formular sichtbar; Hinweis „Systemmails (Einladung, Passwort) laufen über OpenBills · eigener Absender ab Enterprise". Solange kein eigenes SMTP aktiv: zusätzlich „Rechnungen werden derzeit über <instanz>@openbills.de versendet".
- Enterprise/Self-Hosted: unverändert.

### Mail-Layout

- Einladung und Passwort-Reset übernehmen das Layout der Rechnungsmails: Kopfbereich in Firmen-Primärfarbe mit Firmenname, Karte mit Text, Button statt nacktem Link (Link zusätzlich als Text darunter), Fußzeile „Versendet über OpenBills". Plain-Text-Variante bleibt.
- Firmenfarbe/-name aus den Firmeneinstellungen; fehlen sie, OpenBills-Defaults (`#2563eb`, „OpenBills").

## Voraussetzungen (außerhalb des Codes)

- openbills.de bei Brevo als Absenderdomain verifiziert (SPF, DKIM, DMARC), damit beliebige `<instanz>@openbills.de` zustellbar sind.

## Dem Builder überlassen

- Ob Routing in `plan.js` oder eigenem Modul; Form des Compose-Helpers in den Shell-Skripten.
- Gemeinsames HTML-Grundgerüst für Mails extrahieren oder nur für Auth-Mails nachbauen.
- Tests: Vitest für Routing-Matrix, Startprüfung, Absender/Reply-To je Tarif, 403 beim SMTP-Speichern; Contract-Tests für nodemailer anpassen.
- Doku: `CLAUDE.md` (Plan-Tiers-Abschnitt) und `docs/superpowers/specs/2026-11-13-plan-tiers.md` ergänzen.
