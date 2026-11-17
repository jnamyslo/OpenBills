# Plattform-Mailversand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hosted-Tarife (free/starter/professional) versenden System- und teils Kundenmails über den zentralen Brevo-Relay von openbills.de; eigener Absender wird Upgrade-Feature.

**Architecture:** Zwei neue Plan-Features (`ownSmtp`, `ownSystemSmtp`) kodieren die Matrix. Neues Modul `backend/services/mailRouting.js` entscheidet pro Mailart (`system` | `customer`) zwischen Plattform und eigenem SMTP, baut den Plattform-Transport aus `PLATFORM_SMTP_*` und erzwingt das Tageslimit. `emailService.createTransporter/getSenderInfo` und `authMailService` fragen das Routing; Zugangsdaten kommen über `.env.platform` + Compose-Override nur in Plattform-Instanzen.

**Tech Stack:** Node 24 / Express (ESM), nodemailer, PostgreSQL, Vitest; React 18 + TS; bash + Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-14-platform-mail-design.md`

## Global Constraints

- Zugangsdaten nie im Repo/Image. `.env.platform` ist durch `.env.*` in `.gitignore` bereits ausgeschlossen.
- Plattform-Tarife = `free`, `starter`, `professional`. Enterprise und Self-Hosted bekommen nie Plattform-Zugangsdaten.
- Systemabsender: `"OpenBills" <support@openbills.de>`. Kundenabsender: `"<Firmenname>" <<OPENBILLS_INSTANCE>@openbills.de>`, `replyTo` = `company.email` (fehlt → kein Reply-To).
- Kein stiller Fallback von Plattform auf Kunden-SMTP.
- Tageslimit Plattform-Kundenmails: `20` pro Tag (Europe/Berlin) und Instanz, Konstante. Fehler: HTTP 429, `code: 'PLATFORM_MAIL_LIMIT'`.
- Instanzname bei Plattform-Tarif: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`.
- UI-Texte deutsch. Strict TS (`noUnusedLocals`, `noUnusedParameters`).
- Backend ESM, Imports mit `.js`.
- Tests nur in Docker (Befehl siehe CLAUDE.md, im Ordner `backend/` bzw. Root). Kurzform unten: `BACKEND_TEST` = `docker run --rm -v "$PWD/backend":/src:ro node:24-alpine sh -c "mkdir /app && cd /src && tar cf - --exclude=node_modules . | tar xf - -C /app && cd /app && npm ci && npx vitest run --config vitest.config.mjs <file>"`; `FRONTEND_TEST` analog mit `$PWD` und `npx vitest run <file>`.

## Review Focus

- Professional mit DB-Zeile `is_enabled = false` aber gesetztem `smtp_host` → muss Plattform sein (nicht „eigenes SMTP"). Test in Task 2.
- Firma ohne Eintrag in `company` (frische Instanz, Einladung vor Firmen-Setup) → Auth-Mail muss mit Defaults `#2563eb`/„OpenBills" rausgehen, Kundenmail ohne Reply-To. Tests in Task 3 und Task 5.
- Mehrere Empfänger in einem Request (Multi-Format-Rechnung schleift über `email`-Liste) → Limit wird vor dem Request geprüft; überschreitet ein Request das Restkontingent leicht, ist das akzeptiert. Test in Task 4 prüft nur: bei Zähler ≥ 20 → 429.
- Fehlgeschlagene Sends (`status = 'failed'`) dürfen das Limit nicht verbrauchen. Test in Task 4.
- `OPENBILLS_INSTANCE` mit Großbuchstaben/Leerzeichen (manuell editiert) → Backend-Start bricht ab statt kaputter Absenderadresse. Test in Task 2.

---

### Task 1: Plan-Features `ownSmtp` / `ownSystemSmtp`

**Files:**
- Modify: `backend/utils/plan.js`
- Modify: `src/types/index.ts` (Typ `PlanFeature`)
- Modify: `src/context/PlanContext.tsx` (`FEATURE_LABELS`)
- Test: `backend/tests/plan.test.js`

**Interfaces:**
- Produces: `FEATURES` enthält zusätzlich `'ownSmtp'`, `'ownSystemSmtp'`. `selfhosted`, `enterprise`: alle. `professional`: alle außer `ownSystemSmtp`. `starter`: `['email', 'reminders']`. `free`: `[]`. `hasFeature('ownSmtp' | 'ownSystemSmtp')` funktioniert damit.

- [ ] **Step 1: Failing test** in `plan.test.js`, `describe('Mail-Features')`:
  ```js
  it.each([
    ['', true, true], ['enterprise', true, true], ['professional', true, false],
    ['starter', false, false], ['free', false, false],
  ])('Plan "%s": ownSmtp=%s ownSystemSmtp=%s', (plan, own, ownSystem) => {
    vi.stubEnv('OPENBILLS_PLAN', plan);
    expect(hasFeature('ownSmtp')).toBe(own);
    expect(hasFeature('ownSystemSmtp')).toBe(ownSystem);
  });
  ```
  Bestehende Tests, die Feature-Listen exakt vergleichen, an die neue Liste anpassen.
- [ ] **Step 2:** `BACKEND_TEST tests/plan.test.js` → FAIL.
- [ ] **Step 3:** `plan.js` anpassen (professional: `FEATURES.filter(f => f !== 'ownSystemSmtp')`). Frontend: `PlanFeature` um beide Werte erweitern; Labels `ownSmtp: 'Eigener Mailserver für Rechnungsversand'`, `ownSystemSmtp: 'Eigener Absender für Systemmails'`.
- [ ] **Step 4:** `BACKEND_TEST tests/plan.test.js` → PASS. Frontend-Build/TS: `docker compose --env-file .env.<instanz> -f docker-compose.yml build frontend` oder `FRONTEND_TEST` + `npx tsc --noEmit` → keine Fehler.
- [ ] **Step 5: Commit** `feat(plan): add ownSmtp and ownSystemSmtp features`

### Task 2: Mail-Routing-Modul + Startprüfung

**Files:**
- Create: `backend/services/mailRouting.js`
- Modify: `backend/server.js` (nach `assertAuthConfig()` im selben try)
- Test: `backend/tests/mailRouting.test.js` (mock `../database.js` wie in `authMail.test.js`, mock `nodemailer`)

**Interfaces:**
- Produces:
  - `export const PLATFORM_DOMAIN = 'openbills.de'`
  - `export const PLATFORM_SYSTEM_SENDER = { name: 'OpenBills', email: 'support@openbills.de' }`
  - `export function isPlatformInstance(): boolean` — `!hasFeature('ownSystemSmtp')`
  - `export function getPlatformInstanceSender(): string` — `` `${process.env.OPENBILLS_INSTANCE}@openbills.de` ``
  - `export function assertPlatformMailConfig(): void` — nur wenn `isPlatformInstance()`: wirft, wenn `PLATFORM_SMTP_HOST`, `PLATFORM_SMTP_USER`, `PLATFORM_SMTP_PASS` leer, oder `OPENBILLS_INSTANCE` leer bzw. verletzt `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. Meldung deutsch, nennt fehlende Variable und `.env.platform`.
  - `export function createPlatformTransporter(): nodemailer.Transporter` — `host/port(Default 587)/secure(=== 'true')/auth` aus `PLATFORM_SMTP_*`.
  - `export async function hasOwnSmtp(): Promise<boolean>` — `SELECT smtp_host FROM smtp_settings WHERE id = 1 AND is_enabled = true`, true wenn Zeile mit nicht-leerem `smtp_host`; DB-Fehler → false.
  - `export async function getMailRoute(kind: 'system' | 'customer'): Promise<'platform' | 'own'>`:
    - `hasFeature('ownSystemSmtp')` → `'own'` (beide Arten).
    - `kind === 'system'` → `'platform'`.
    - customer: `hasFeature('ownSmtp') && await hasOwnSmtp()` → `'own'`, sonst `'platform'`.

- [ ] **Step 1: Failing tests** `mailRouting.test.js`:
  - `getMailRoute` Matrix: `['', 'own','own']`, `['enterprise','own','own']`, `['professional' + hasOwnSmtp, 'platform','own']`, `['professional' ohne, 'platform','platform']`, `['starter','platform','platform']`, `['free','platform','platform']` (Reihenfolge: plan, system, customer).
  - Professional mit `queryMock` → `{ rows: [] }` (weil `is_enabled = false` gefiltert) → customer `'platform'`.
  - `assertPlatformMailConfig`: selfhosted ohne Vars → wirft nicht; starter ohne `PLATFORM_SMTP_PASS` → wirft `/PLATFORM_SMTP_PASS/`; starter mit `OPENBILLS_INSTANCE='Mein Kunde'` → wirft `/OPENBILLS_INSTANCE/`; starter vollständig → wirft nicht.
  - `createPlatformTransporter` ruft `nodemailer.createTransport` mit `{ host, port: 587, secure: false, auth: { user, pass } }`.
- [ ] **Step 2:** `BACKEND_TEST tests/mailRouting.test.js` → FAIL (Modul fehlt).
- [ ] **Step 3:** Modul implementieren; in `server.js` `assertPlatformMailConfig()` direkt nach `assertAuthConfig()` aufrufen (gleicher `try`, `process.exit(1)`).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `feat(mail): add platform mail routing`

### Task 3: Kundenmails über Routing

**Files:**
- Modify: `backend/services/emailService.js` (`createTransporter` Z. 51, `getSenderInfo` Z. 247, `mailOptions` in `sendInvoiceEmailMultiFormat` Z. ~521, `sendInvoiceEmail` Z. ~708, `sendQuoteEmail` Z. ~1000, `sendReminderEmail` Z. ~1313)
- Test: `backend/tests/emailRouting.test.js`

**Interfaces:**
- Consumes: `getMailRoute`, `createPlatformTransporter`, `getPlatformInstanceSender` (Task 2).
- Produces: `createTransporter()` liefert bei customer-Route `'platform'` den Plattform-Transport, sonst bisherige Logik unverändert. `getSenderInfo(): Promise<{ email: string, name: string, replyTo?: string }>` — bei Plattform: `email = getPlatformInstanceSender()`, `name = company.name || 'OpenBills'`, `replyTo = company.email || undefined` (aus `SELECT name, email FROM company WHERE id = 1`); sonst wie bisher ohne `replyTo`. Alle vier `mailOptions` setzen `replyTo: senderInfo.replyTo` (nodemailer ignoriert `undefined`). Historie speichert weiter `senderInfo.email` → ist bei Plattform automatisch die Plattformadresse.

- [ ] **Step 1: Failing tests** (mock `../database.js`, `nodemailer`, `../services/mailRouting.js` nicht mocken, sondern Env stubben):
  - Starter, company `{ name: 'Muster GmbH', email: 'info@muster.de' }`, `OPENBILLS_INSTANCE='muster'` → `getSenderInfo()` = `{ email: 'muster@openbills.de', name: 'Muster GmbH', replyTo: 'info@muster.de' }`.
  - Starter ohne company-Zeile → `{ email: 'muster@openbills.de', name: 'OpenBills', replyTo: undefined }`.
  - Starter, `smtp_settings` mit eigenem Host → `createTransporter()` nutzt `PLATFORM_SMTP_HOST` (nodemailer-Mock-Argument prüfen), nicht DB-Host.
  - Selfhosted → `createTransporter()` nutzt DB-Host wie bisher; `getSenderInfo()` ohne `replyTo`.
  - `sendQuoteEmail` (minimaler Input, `pdfBuffer` base64) unter Starter → `sendMail`-Argument hat `replyTo: 'info@muster.de'` und `from` enthält `muster@openbills.de`.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** Implementieren. Achtung: `getSenderInfo` wird auch in `sendQuoteEmail` Z. 1044 und `sendReminderEmail` Z. 1366 für die Historie aufgerufen – bleibt korrekt.
- [ ] **Step 4:** Test + `BACKEND_TEST` (gesamte Suite) → PASS.
- [ ] **Step 5: Commit** `feat(mail): send customer mails via platform on hosted tiers`

### Task 4: Tageslimit für Plattform-Kundenmails

**Files:**
- Modify: `backend/services/mailRouting.js`
- Modify: `backend/utils/plan.js` (nur falls `PlanError`-Body erweitert werden muss; Klasse wiederverwenden)
- Modify: `backend/app.js:79` (`/api/email`), `backend/routes/quotes.js:106` (`send-email`)
- Modify: `src/services/api.ts:121`, `src/types/index.ts` (`PlanErrorBody.code`)
- Test: `backend/tests/mailRouting.test.js`

**Interfaces:**
- Produces:
  - `export const PLATFORM_MAIL_DAILY_LIMIT = 20`
  - `export async function countPlatformCustomerMailsToday(): Promise<number>` — `SELECT COUNT(*) FROM email_history WHERE sender_email = $1 AND status = 'sent' AND sent_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')`, `$1 = getPlatformInstanceSender()`.
  - `export async function enforcePlatformMailLimit(req, res, next)` — nur wenn `getMailRoute('customer') === 'platform'` und `req.method !== 'GET'`; bei Zähler ≥ Limit `sendPlanError(res, new PlanError(429, { error: 'Tageslimit für den E-Mail-Versand über OpenBills erreicht (20 pro Tag). Für mehr bitte Ihren Tarif upgraden.', code: 'PLATFORM_MAIL_LIMIT', limit: 20, plan: getPlanName(), upgradeContact: getUpgradeContact() }))`.
  - Frontend: `PlanErrorBody.code` um `'PLATFORM_MAIL_LIMIT'` erweitert; `api.ts` behandelt den Code wie die beiden anderen (Upgrade-Dialog).

- [ ] **Step 1: Failing tests:** Starter, Count-Query → `{ rows: [{ count: '20' }] }` → Middleware antwortet 429 mit `code: 'PLATFORM_MAIL_LIMIT'`, `next` nicht aufgerufen; `'19'` → `next()`; Selfhosted → `next()` ohne Count-Query; GET → `next()`. Query-Text enthält `status = 'sent'` (failed zählt nicht).
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** Implementieren; einhängen: `app.use('/api/email', requireFeature('email'), enforcePlatformMailLimit, emailRouter)` und in `quotes.js` `router.post('/:id/send-email', requireFeature('email'), enforcePlatformMailLimit, …)`. Frontend-Code ergänzen.
- [ ] **Step 4:** Backend-Suite + Frontend-TS → PASS.
- [ ] **Step 5: Commit** `feat(mail): daily limit for platform customer mails`

### Task 5: Auth-Mails über Routing + neues Layout

**Files:**
- Create: `backend/services/authMailLayout.js`
- Modify: `backend/services/authMailService.js`
- Test: `backend/tests/authMail.test.js`

**Interfaces:**
- Consumes: `getMailRoute`, `createPlatformTransporter`, `PLATFORM_SYSTEM_SENDER` (Task 2).
- Produces:
  - `export function renderAuthMail({ heading, paragraphs, buttonLabel, link, note, companyName, primaryColor, secondaryColor }): string` — gleiches Gerüst wie Rechnungsmail (`emailService.js` Z. ~300–395): `.header` mit Gradient `primaryColor → secondaryColor` und `<h1>heading</h1>`, `.content` mit Absätzen, Button (`<a>` mit Hintergrund `primaryColor`, weiße Schrift, `display:inline-block`), Link zusätzlich als Text darunter, `.info-box` mit `note`, `.footer` mit `companyName` und „Versendet über OpenBills". Alle Werte `escapeHtml`.
  - `authMailService.send` : Route `'platform'` → `createPlatformTransporter()` + Absender `"OpenBills" <support@openbills.de>`; sonst bisherige `createTransporter/getSenderInfo`.
  - `isSmtpConfigured()` → `true`, wenn `getMailRoute('system') === 'platform'`; sonst bisherige Logik.
  - Branding aus `SELECT name, primary_color, secondary_color FROM company WHERE id = 1`; fehlend/DB-Fehler → `'OpenBills'`, `'#2563eb'`, `'#64748b'`.
  - Texte (Plain + HTML) inhaltlich wie heute; Einladung: Heading „Einladung zu OpenBills", Button „Passwort festlegen", Note „Der Link ist 48 Stunden gültig und kann nur einmal verwendet werden."; Reset: Heading „Passwort zurücksetzen", Button „Neues Passwort festlegen", Note „Der Link ist 1 Stunde gültig … ignorieren." Betreffzeilen unverändert.

- [ ] **Step 1: Failing tests** (Mocks erweitern: `../services/mailRouting.js` mit `getMailRoute`, `createPlatformTransporter`, `PLATFORM_SYSTEM_SENDER`):
  - Route `'platform'` → `from` = `'"OpenBills" <support@openbills.de>'`, Plattform-Transport benutzt, `createTransporter` nicht aufgerufen.
  - Route `'own'` → bisheriges `from@x.de`.
  - Einladung HTML enthält Button-Text „Passwort festlegen", den escapten Link zweimal (href + Text), `background: linear-gradient(135deg, #123456` bei company `primary_color: '#123456'`, und „Versendet über OpenBills".
  - Ohne company-Zeile → HTML enthält `#2563eb`.
  - `isSmtpConfigured` unter Route `'platform'` → true ohne DB-Abfrage. Bestehende Escape- und `isSmtpConfigured`-Tests bleiben grün (mit Route `'own'`).
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `BACKEND_TEST tests/authMail.test.js` + gesamte Suite (u. a. `authFlows`, `users`) → PASS.
- [ ] **Step 5: Commit** `feat(auth): route system mails via platform and restyle templates`

### Task 6: SMTP-Verwaltung sperren + Mail-Routen in `/api/plan`

**Files:**
- Modify: `backend/routes/emailManagement.js` (Z. 317, 417, 480, 556, 666, 765)
- Modify: `backend/routes/plan.js`
- Modify: `src/types/index.ts` (`PlanInfo`)
- Test: `backend/tests/accessControl.test.js` (bestehendes App-Test-Muster nutzen) oder neue `backend/tests/emailManagementPlan.test.js` nach demselben Muster

**Interfaces:**
- Consumes: `requireFeature` (plan.js), `getMailRoute` (Task 2).
- Produces:
  - `requireFeature('ownSmtp')` vor `requireAdmin`-Handler auf `POST /smtp-settings`, `/debug-config`, `/diagnose-smtp`, `/test-smtp`, `/test-network`, `/send-test-email`. `GET /smtp-settings` bleibt offen (Formular-Laden bei Pro).
  - `GET /api/plan` liefert zusätzlich `mailRoutes: { system: 'platform' | 'own', customer: 'platform' | 'own' }`.
  - `PlanInfo.mailRoutes: { system: 'platform' | 'own'; customer: 'platform' | 'own' }`.

- [ ] **Step 1: Failing tests:** Starter, Admin-Session: `POST /api/email-management/smtp-settings` → 403 `FEATURE_NOT_IN_PLAN`, `feature: 'ownSmtp'`; gleiches für `POST /send-test-email`. Professional: `POST /smtp-settings` → nicht 403. `GET /api/plan` unter Starter → `mailRoutes` = `{ system: 'platform', customer: 'platform' }`; Selfhosted → `{ own, own }`.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** Suite → PASS.
- [ ] **Step 5: Commit** `feat(mail): gate own SMTP management behind ownSmtp`

### Task 7: Frontend-Hinweise in der E-Mail-Verwaltung

**Files:**
- Modify: `src/components/EmailManagement.tsx` (Tab `settings` ab Z. ~387, Test-Tab)

**Interfaces:**
- Consumes: `usePlan()` → `plan.mailRoutes`, `hasFeature('ownSmtp')`, `hasFeature('ownSystemSmtp')`, `plan.upgradeContact`; `OPENBILLS_INSTANCE` ist im Frontend nicht bekannt → Adresse nicht anzeigen, nur „über OpenBills".

- [ ] **Step 1:** Ohne `ownSmtp`: SMTP-Formular und Test-Tab-Aktionen (`test-smtp`, `send-test-email`) ausblenden; stattdessen Infobox „E-Mails werden über OpenBills versendet · eigener Mailserver ab Professional" (+ `Kontakt: <upgradeContact>`, falls gesetzt). `loadSmtpSettings` darf weiter laufen.
- [ ] **Step 2:** Mit `ownSmtp`, ohne `ownSystemSmtp`: Formular sichtbar; Infobox „Systemmails (Einladung, Passwort) laufen über OpenBills · eigener Absender ab Enterprise". Zusätzlich bei `mailRoutes.customer === 'platform'`: „Rechnungen werden derzeit über OpenBills versendet, bis ein eigener Mailserver aktiviert ist."
- [ ] **Step 3:** Mit `ownSystemSmtp`: unverändert.
- [ ] **Step 4:** Frontend-Build ohne TS/ESLint-Fehler (`docker compose … build frontend`); manuell im Browser mit `OPENBILLS_PLAN=starter` und `professional` prüfen.
- [ ] **Step 5: Commit** `feat(ui): show platform mail hints in email settings`

### Task 8: Deployment (`.env.platform`, Compose-Override, Skripte) + Doku

**Files:**
- Create: `docker-compose.platform.yml` (nur `services.backend.env_file: [.env.platform]` – Compose mergt `env_file`-Listen)
- Create: `scripts/platform.sh` (von beiden Skripten per `source "$(dirname "$0")/scripts/platform.sh"` geladen)
- Modify: `docker-compose.yml` (backend `environment`: `- OPENBILLS_INSTANCE=${INSTANCE_NAME:-}`)
- Modify: `deploy-instance.sh` (alle `docker compose … -f docker-compose.yml`-Aufrufe: Z. 133, 309, 508; Planabfrage Z. 239; Legacy Z. 441–450)
- Modify: `manage-instances.sh` (Z. 87, 135, 177, 208, 210, 317)
- Modify: `CLAUDE.md` (Abschnitt Plan-Tiers), `docs/superpowers/specs/2026-11-13-plan-tiers.md` (Verweis auf neue Spec)

**Interfaces:**
- Produces (`scripts/platform.sh`):
  - `PLATFORM_PLANS="free starter professional"`
  - `is_platform_plan <plan>` → 0/1
  - `instance_plan <name>` → Plan aus `.env.backend.<name>` (gleiche grep-Logik wie `manage-instances.sh:55`)
  - `compose_cmd <name>` → setzt Array `COMPOSE=(docker compose --env-file .env.<name> -f docker-compose.yml [-f docker-compose.platform.yml])`
  - `check_platform_ready <name>` → bei Plattform-Plan: Fehler + return 1, wenn `.env.platform` fehlt („Plattform-Mailzugang fehlt: .env.platform anlegen (./deploy-instance.sh fragt ihn ab)") oder Name die Regex verletzt.
  - `ensure_platform_env` → fehlt `.env.platform`: interaktiv Host (Default `smtp-relay.brevo.com`), Port (Default `587`), User, Key (`read -s`) abfragen, Datei mit `PLATFORM_SMTP_HOST/PORT/SECURE=false/USER/PASS` schreiben, `chmod 600`.

- [ ] **Step 1:** `platform.sh` schreiben; `bash -n scripts/platform.sh` → kein Fehler. Kurzer Selbsttest im Container: `docker run --rm -v "$PWD":/w -w /w bash:5 bash -c 'source scripts/platform.sh; is_platform_plan starter && ! is_platform_plan enterprise && ! is_platform_plan "" && echo OK'` → `OK`.
- [ ] **Step 2:** `deploy-instance.sh`: nach Planwahl bei Plattform-Plan Namensregex prüfen (erneut fragen im interaktiven Modus, Abbruch im Legacy-Modus) und `ensure_platform_env` (interaktiv) bzw. Abbruch, wenn Datei fehlt (Legacy). Alle Compose-Aufrufe über `compose_cmd`.
- [ ] **Step 3:** `manage-instances.sh`: alle Compose-Aufrufe über `compose_cmd`; `start`/`restart` rufen vorher `check_platform_ready` und brechen bei Fehler ab.
- [ ] **Step 4:** Verifikation: `docker compose --env-file .env.<test> -f docker-compose.yml -f docker-compose.platform.yml config | grep -c PLATFORM_SMTP_HOST` → ≥ 1 mit vorhandener `.env.platform`; Test-Instanz `starter` deployen → Backend startet, Einladung im UI auslösen → Mail kommt von `support@openbills.de`; `.env.platform` temporär umbenennen → `manage-instances.sh restart` bricht mit Meldung ab. Selfhosted-Instanz: `config` zeigt kein `PLATFORM_SMTP_*`.
- [ ] **Step 5:** Doku: CLAUDE.md Plan-Tiers um 2–3 Zeilen ergänzen (`.env.platform`, `docker-compose.platform.yml`, Spec-Link); Plan-Tiers-Spec verlinkt neue Spec.
- [ ] **Step 6: Commit** `feat(deploy): provision platform mail credentials for hosted tiers`
