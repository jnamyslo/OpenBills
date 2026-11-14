# Demo-Modus (`OPENBILLS_DEMO`)

## Intent

Öffentliche Demo-Instanz, verlinkt aus dem GitHub-README, damit Interessierte OpenBills ohne Installation ausprobieren können. Voller Funktionsumfang, aber abgeriegelt: keine Mails nach außen, Besucher können sich nicht gegenseitig aussperren oder die Instanz zerstören. Daten werden alle 3 Stunden automatisch auf realistische Demo-Daten zurückgesetzt.

## Goals

- Aktivierung allein über `OPENBILLS_DEMO=true` in `.env.backend.<name>`.
- Gemeinsamer Demo-Login, Zugangsdaten auf der Login-Seite sichtbar, Ein-Klick-Login.
- Alle Features freigeschaltet (Plan `selfhosted`).
- Kein Mailversand nach außen, egal über welchen Weg.
- Automatischer Reset alle 3 h mit frischen, datums-relativen Demo-Daten.

## Non-Goals

- Getrennte Sandbox pro Besucher.
- Hosting/Deployment der Demo selbst, DNS, README-Link (separat).
- Missbrauchsschutz über die Sperrliste hinaus (z. B. Moderation hochgeladener Logos/Anhänge – der 3-h-Reset begrenzt das).

## Anti-Goals

- Eine Mail verlässt die Demo-Instanz.
- Ein Besucher kann den Demo-Login für andere unbrauchbar machen (Passwort, 2FA, Sperre durch Fehlversuche, Rolle/E-Mail ändern, Sessions killen).
- Demo-Code verändert das Verhalten normaler Instanzen (ohne Flag muss alles exakt wie heute laufen).

## Approaches

1. **Alles im Backend (gewählt).** Backend erkennt `OPENBILLS_DEMO`, setzt sich beim Start und alle 3 h selbst zurück, spielt Seed aus `backend/demo/seed.js` ein, fängt Mails auf Transport-Ebene ab, sperrt kritische Routen per Middleware. Kein Host-Cron nötig, Daten immer datums-relativ, alles an einer Stelle testbar.
2. Demo-Daten als Backup-ZIP im Repo, Host-Cron spielt es per Restore ein. Verworfen: feste Datumswerte veralten (überfällig/aktueller Monat stimmen nicht), Host-Cron nötig, Binärdatei im Repo.
3. Host-Cron baut DB-Volume alle 3 h neu auf. Verworfen: Downtime, Onboarding jedes Mal, Seed-Problem bleibt.

## Design

### Konfiguration

- `OPENBILLS_DEMO=true` aktiviert. Jeder andere/fehlende Wert = aus.
- Demo + gesetztes `OPENBILLS_PLAN` → Backend startet nicht (klare Fehlermeldung). Im Demo-Modus gilt `selfhosted`; damit greift auch keine Plattform-Mail-Pflicht.
- `PUBLIC_URL`, `AUTH_ENCRYPTION_KEY` weiter Pflicht wie heute.
- Demo-Zugang fest im Code: `demo@openbills.de` / `demo` (Konstanten in `backend/demo/`). Kein Geheimnis.
- Modul `backend/demo/index.js` exportiert `isDemoMode()` und die Konstanten; alle Demo-Abfragen gehen darüber.

### Reset

- Beim Start (nach Migrationen) und danach zu jeder vollen 3. Stunde (00, 03, 06, … Uhr, Serverzeit/TZ des Containers) per Timer in `server.js` (Muster wie `runCleanup`, `.unref()`).
- **Schutz echter Daten (Entscheidung Nutzer):** Vor jedem Reset prüft das Backend, ob die DB eine Demo-Markierung trägt (eigene Tabelle `demo_marker`, per Migration angelegt, nicht im Truncate, nicht in `BACKUP_TABLES`) oder leer ist (keine Zeilen in `users`, `invoices`, `customers`). Weder markiert noch leer → Reset verweigert; beim Start bricht das Backend mit „Datenbank enthält echte Daten – Demo-Modus verweigert“ ab. Der erste erfolgreiche Reset auf leerer DB setzt die Markierung. Ohne Demo-Flag wird `demo_marker` ignoriert.
- In einer Transaktion:
  1. `TRUNCATE` aller App-Tabellen (`BACKUP_TABLES`) und Auth-Tabellen (`users`, `user_recovery_codes`, `sessions`, `auth_tokens`, `rate_limits`, `audit_log`) `CASCADE`. Plan-Usage-Zähler ebenfalls.
  2. Demo-User anlegen (Admin, kein Operator, kein 2FA).
  3. Seed einspielen.
- Danach: Dateien im Backup-Verzeichnis löschen (`backups/`), damit von Besuchern erzeugte Backups nicht liegen bleiben.
- Sessions sind weg → aktive Besucher landen beim nächsten Request auf dem Login (bestehendes 401-Verhalten).
- Fehler beim Reset: loggen, Instanz läuft weiter; nächster Versuch beim nächsten Intervall. Fehler beim Start-Reset: Start abbrechen.
- Nächster Reset-Zeitpunkt wird berechnet und dem Frontend geliefert (s. u.).

### Deployment-Skripte *(nach Builder-Check, eigene Entscheidung)*

- `deploy-instance.sh` und `manage-instances.sh` erkennen `OPENBILLS_DEMO=true` in `.env.backend.<name>` und überspringen Support-Zugang (`operator.js`) und Onboarding-Link (`onboarding.js`); stattdessen Hinweis „Demo-Instanz – Login: demo@openbills.de / demo“. `onboarding-link` und `operator-reset` brechen bei Demo-Instanzen mit Hinweis ab.
- Demo-Instanzen haben keinen Support-Zugang; der Reset leert `users` komplett.

### Demo-Daten (`backend/demo/seed.js`)

Fiktive Firma „Mustermann Haustechnik GmbH“ (o. ä., erkennbar fiktiv: Musterstraße, IBAN aus Beispiel-Bereich DE02…, Mails `@example.com`). Alle Datumswerte relativ zum Reset-Zeitpunkt.

- Firma vollständig (Adresse, Kontakt, Bank, USt-ID, Farben, eRechnung-Einstellungen, alle Module an, Mahnwesen konfiguriert). Logo optional (kleines generiertes SVG/PNG als Data-URL).
- ~8 Kunden (Firmen und Privat, teils mit kundenspezifischen Preisen).
- Stundensätze (3–4) und Materialvorlagen (~8).
- Rechnungen ~15 über die letzten ~6 Monate: Entwurf, offen, bezahlt, überfällig (Mahnstufe 1 und 2 mit Mahnungen).
- Angebote ~5: Entwurf, versendet, angenommen (eins in Rechnung umgewandelt), abgelehnt.
- Aufträge ~6 mit Zeiten und Material, teils abgerechnet.
- Rechnungsnummern konsistent mit Nummernkreis-Logik.
- Seed schreibt direkt per SQL über die bestehenden Tabellen (keine HTTP-Aufrufe); Quota-Zählung irrelevant (selfhosted).

### Mails abfangen

- Zentrale Stelle: `createTransporter` (`services/emailService.js`) und `createPlatformTransporter` (`services/mailRouting.js`) liefern im Demo-Modus `nodemailer.createTransport({ jsonTransport: true })`. Damit laufen alle Sendepfade (Rechnung, Angebot, Mahnung, Einladung, PW-Reset, Test-Mail) durch, aber nichts geht raus. Log-Eintrag „Demo: Mail nicht versendet“ mit Empfänger und Betreff.
- Sendet ein Pfad nodemailer an diesen Funktionen vorbei, wird er ebenfalls umgestellt (Builder prüft per grep).
- Erfolgsantworten der Sende-Routen bleiben wie im Normalfall, damit Status-Wechsel (z. B. „versendet“) demonstrierbar sind. Frontend zeigt im Demo-Modus zusätzlich den Hinweis „Demo: E-Mail wurde nicht wirklich versendet“ nach erfolgreichem Versand.

### Gesperrte Aktionen

Middleware `demoGuard` nach dem Auth-Gate, nur im Demo-Modus aktiv. Antwort `403 { error: 'In der Demo deaktiviert', code: 'DEMO_DISABLED' }`.

| Route | Grund |
|---|---|
| `POST /api/auth/password` | Passwort ändern |
| `POST /api/auth/totp/setup`, `/totp/enable`, `/totp/disable` | 2FA |
| `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/:token` | Reset |
| `POST /api/auth/setup`, `POST /api/auth/invite/:token` | Onboarding |
| `POST /api/users/invite`, `PUT /api/users/:id`, `POST /api/users/:id/*`, `DELETE /api/users/:id/sessions` | Benutzerverwaltung |
| `POST /api/backup/restore-zip`, `DELETE /api/backup/delete/:filename` | Restore/Löschen |
| `POST /api/email-management/smtp-settings` und übrige SMTP-Test-/Diagnose-Routen | SMTP |

(Pfade gegen `server.js`-Registrierung verifizieren.) Backup erstellen/herunterladen bleibt erlaubt.

Zusätzlich: Login-Fehlversuche auf den Demo-User führen nicht zur Kontosperre (`recordLoginFailure` im Demo-Modus für den Demo-User überspringen). IP-basiertes Rate-Limit bleibt.

Frontend: Buttons der gesperrten Aktionen bleiben sichtbar, sind im Demo-Modus deaktiviert mit Tooltip/Hinweis „In der Demo deaktiviert“. Backend ist die Absicherung, Frontend nur UX.

### Frontend

- Neuer öffentlicher Endpoint `GET /api/demo` (in `PUBLIC_API_PATHS`): `{ demo: boolean, email?, password?, nextResetAt? }`. Ohne Demo-Modus nur `{ demo: false }`.
- Login-Seite: im Demo-Modus Kasten „Demo-Zugang“ mit E-Mail/Passwort und Button „Als Demo anmelden“ (füllt und sendet). „Passwort vergessen“ ausgeblendet.
- Banner oben in der App (alle Seiten, nicht schließbar, dezent): „Demo-Instanz – alle Daten werden alle 3 Stunden zurückgesetzt (nächster Reset: HH:MM Uhr). E-Mails werden nicht versendet.“
- Kleiner Context/Hook (`useDemo`) analog `PlanContext`.

## Constraints

- Backend ES Modules, `.js`-Imports. UI-Text Deutsch. Strict TS.
- Neue Routen sind automatisch geschützt; `/api/demo` bewusst in Whitelist.
- Tests in Docker (Vitest frontend/backend).

## Testen

- Backend: Schutzprüfung (leer → ok, markiert → ok, Daten ohne Markierung → verweigert); `isDemoMode`/Plan-Konflikt; `demoGuard` sperrt Liste und lässt Rest durch, inaktiv ohne Flag; Transporter liefert jsonTransport im Demo-Modus und echten ohne; Reset-Zeitberechnung (nächste volle 3. Stunde); Seed läuft gegen leere DB ohne Fehler (soweit ohne DB testbar: Datums-Relativierung).
- Manuell: Instanz mit Flag deployen, Demo-Login, Rechnung per Mail „senden“ (Log statt Versand), gesperrte Aktionen → Hinweis, Reset auslösen (kurzes Intervall per Test-Hook o. ä.).

## Für den Builder offen

- Konkrete Seed-Inhalte (Namen, Positionen, Beträge) – realistisch Handwerk/Dienstleistung, deutsch.
- Wie Reset in Tests/manuell schneller ausgelöst wird (z. B. Env `OPENBILLS_DEMO_RESET_MINUTES` nur für Tests – nur wenn nötig).
- Exakte Tabellenliste für Truncate aus Migrationen ableiten.
