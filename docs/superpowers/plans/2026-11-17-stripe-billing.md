# Umsetzungsplan Stripe-Abrechnung (Stufe 2)

Ziel: Buchen, Wechseln und Bezahlen der Managed-Tarife läuft über Stripe. Stripe-Webhooks steuern die vorhandenen Instanz-Workflows (Deploy, `set-plan`). Rechnungen stellt Stripe aus.

Betroffen sind zwei Repos:

- **OpenBills-Landing** (`request-api`, GitHub-Workflows, Website, Rechtstexte): der Großteil der Arbeit. Das Repo hat keinen Branch `feat/local-auth`, deshalb dort eigener Branch `feat/stripe-billing` von `main`.
- **OpenBills** (dieses Repo, Branch `feat/stripe-billing` von `feat/local-auth`): `deploy-instance.sh`, `manage-instances.sh`, Texte im Upgrade-Dialog.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Quelle der Wahrheit für Abos | Stripe. `request-api` bleibt zustandslos; Zuordnung Abo → Instanz über `metadata.slug` an Subscription und Customer. |
| Free-Tarif | Läuft auch über Stripe: Preis 0 €, Checkout mit `payment_method_collection: 'if_required'` (keine Karte nötig). Alle Kunden haben so ein Abo und können im Portal selbst upgraden. |
| `/approve` | **Bezahltarife: entfällt.** Die erfolgreiche Zahlung ist die Freigabe, der Deploy startet automatisch. **Free: bleibt** (Repo-Variable `AUTO_DEPLOY_FREE`, Default `false`), weil sonst jeder ohne Prüfung beliebig viele Instanzen starten kann und jede Instanz einen kompletten Stack auf dem Host belegt. `/approve` bleibt außerdem als manueller Weg für fehlgeschlagene Deploys (z. B. bei einer Slug-Kollision: `/approve slug=…`). |
| Abrechnungszeitraum | Monatlich, Stichtag Monatserster (`billing_cycle_anchor`). Der erste Teilmonat wird anteilig berechnet. Passt zu „Kündigung zum Monatsende“ (§ 6). |
| Upgrade / Downgrade | Selbst im Stripe Customer Portal. Upgrade sofort mit anteiliger Berechnung, Downgrade zum Ende des Zeitraums. |
| Kündigung | Im Portal ist „Abo kündigen“ **aus**. Kündigen des Bezahltarifs = Wechsel auf Free zum Monatsende. Löschen der Instanz nur per Mail und Workflow `remove` (mit Backup-Export). So löscht nie ein Webhook Kundendaten. |
| Zahlungsausfall | Stripe-Mahnlauf (Smart Retries). Danach Abo auf `unpaid` → Instanz auf `free` (Daten bleiben). Wird die Rechnung bezahlt → alter Tarif zurück. |
| Rechnungen | Stripe-Rechnungen mit Hinweis nach § 19 UStG im Footer, Versand per Mail durch Stripe. Kein Stripe Tax, keine Steuersätze. |
| Portal-Zugang | No-Code-Login-Link des Customer Portals (`billing.stripe.com/p/login/…`, Login per Mail-Code). Steht auf der Website und als `OPENBILLS_UPGRADE_CONTACT` in jeder Instanz. Der Upgrade-Dialog kann URLs schon öffnen. |
| SDK | Offizielles `stripe`-npm-Paket in `request-api` (Version pinnen), vor allem für die Signaturprüfung. |

## Ablauf

```
Formular /anfrage/ ─POST /api/anfrage─► request-api
   validieren → Stripe Customer anlegen → Checkout Session (subscription) → { checkoutUrl }
Browser → Stripe Checkout → success_url /anfrage/danke/

Stripe ─POST /api/stripe/webhook─► request-api (Signatur prüfen)
   checkout.session.completed      → dispatch instance-request {…, auto: plan≠free || AUTO_DEPLOY_FREE}
   customer.subscription.updated   → Abo frisch laden → gewünschten Tarif bestimmen → dispatch plan-sync
   customer.subscription.deleted   → dispatch plan-sync {plan: free}
   invoice.payment_failed          → Betreiber-Mail

GitHub: Neue Anfrage (Issue als Protokoll) ──auto──► Instanz deployen (workflow_call)
                                         └─sonst──► wartet auf /approve
        Tarif synchronisieren (plan-sync) ─► manage.sh set-plan (idempotent)
```

Gewünschter Tarif aus einem Abo: Status `active`, `trialing` oder `past_due` → Tarif aus `price.lookup_key` (`openbills_<tarif>_monthly`); sonst (`unpaid`, `canceled`, `incomplete_expired`) → `free`. Der Handler lädt die Subscription immer neu über die API und verlässt sich nicht auf die Reihenfolge der Events. Doppelte Events sind harmlos, weil `set-plan` bei unverändertem Tarif nichts tut.

## Phase 0 – Stripe-Konto einrichten (manuell, zuerst in der Sandbox) ✅ Sandbox (2026-11-17)

Per API geprüft (lesender Restricted Key): `lookup_key`s an allen vier Monatspreisen, Portal mit vier Produkten, Downgrade zum Periodenende (`decreasing_item_amount`), Upgrade sofort (`always_invoice`), Kündigung aus, Login-Link aktiv. Nicht per API prüfbar, laut Betreiber eingerichtet: Konto, Rechnungs-Footer, Mahnlauf, Webhook-Endpunkt, Datenschutz-/AGB-/Rückleitungs-URL (am Portal-Objekt leer, vermutlich in den öffentlichen Kontodaten hinterlegt). Bei Starter liegt ein alter Einmalpreis (29 €, ohne `lookup_key`), der sich nicht archivieren lässt; stört nicht, weil Preise nur über `lookup_key` gesucht werden. Hinweis für den Code: `features.subscription_update.products` der Portal-Konfiguration kommt nur mit `expand` zurück. Live-Modus folgt in Phase 8.

- [x] Konto auf stripe.com anlegen: Land Deutschland, Rechtsform Einzelunternehmen, Firmendaten wie im Impressum, IBAN für Auszahlungen, Identitätsprüfung, 2FA
- [x] Öffentliche Angaben: Name „OpenBills“, Support-Mail, Abrechnungsbezeichnung auf Kontoauszügen (`OPENBILLS`), Branding (Logo, Farbe)
- [x] Zahlungsmethoden: Karte, SEPA-Lastschrift (optional PayPal)
- [x] Produkte mit Monatspreis in EUR, je `lookup_key` (einzige Zuordnung Preis → Tarif; `metadata.plan` nicht nötig):
  - Free 0 € (`openbills_free_monthly`), Starter 29 €, Professional 79 €, Enterprise 149 €
- [x] Billing → Rechnungen: Footer „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“, Rechnungsnummern-Präfix, Mails für fertige Rechnungen und Belege an
- [x] Billing → Abo-Verwaltung: Smart Retries, nach dem letzten Versuch Abo **als unbezahlt markieren**, Mails bei Zahlungsausfall an
- [x] Customer Portal: Tarifwechsel zwischen allen vier Preisen, Upgrade sofort mit anteiliger Berechnung, Downgrade zum Ende des Zeitraums, Zahlungsmethode ändern, Rechnungsverlauf; Kündigung **aus**; Links zu AGB und Datenschutz; Login-Link aktivieren
- [x] Webhook-Endpunkt `https://openbills.de/api/stripe/webhook` mit den Events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`
- [x] Eingeschränkter API-Schlüssel (Restricted Key): Customers *write*, Checkout Sessions *write*, Subscriptions *read*, Products/Prices *read*

## Phase 1 – request-api: Checkout (Landing)

- [ ] `lib/stripe.js`: Client-Fabrik (`STRIPE_SECRET_KEY`), `priceForPlan(plan)` über `lookup_key` (beim Start laden und cachen)
- [ ] `lib/billingAnchor.js`: nächster Monatserster 00:00 Europe/Berlin als Unix-Zeit (eigener Test für Monats- und Jahreswechsel)
- [ ] `POST /api/anfrage` umbauen: nach Validierung und Rate-Limit Customer anlegen (`name` = Firma, `email`, `metadata`: `slug`, `contact`, `city`, `termsVersion`, `acceptedAt`), dann Checkout Session:
  - `mode: 'subscription'`, `customer`, `line_items: [{ price, quantity: 1 }]`, `locale: 'de'`
  - `subscription_data`: `metadata { slug, plan, source: 'openbills-request' }`, `billing_cycle_anchor`, `proration_behavior: 'create_prorations'`
  - `payment_method_collection: 'if_required'`, `billing_address_collection: 'required'`, `customer_update: { address: 'auto', name: 'auto' }` (Anschrift ist Pflichtangabe auf der Rechnung, § 34a UStDV)
  - `success_url`: `/anfrage/danke/?session_id={CHECKOUT_SESSION_ID}`, `cancel_url`: `/anfrage/?abgebrochen=1`
  - Antwort `{ ok: true, checkoutUrl }`
- [ ] Betreiber-Mail erst nach Abschluss des Checkouts schicken (Phase 2), nicht mehr beim Absenden
- [ ] Fallback: Ist `STRIPE_SECRET_KEY` nicht gesetzt oder Stripe nicht erreichbar → bisheriger Ablauf (Mail + Dispatch, Issue mit `/approve`)
- [ ] Tests (vitest, Stripe-Client gemockt): Parameter der Session je Tarif, Fallback, Fehler von Stripe → 502

## Phase 2 – request-api: Webhook (Landing)

- [ ] Route `POST /api/stripe/webhook`: Body roh lesen (max. 64 KB), `stripe.webhooks.constructEvent` mit `STRIPE_WEBHOOK_SECRET`; ungültig → 400. Kein IP-Rate-Limit auf dieser Route.
- [ ] `event.livemode` muss zum Schlüssel passen (`sk_live_` / `sk_test_`), sonst ignorieren (200)
- [ ] Nur Objekte mit `metadata.source === 'openbills-request'` bzw. gesetztem `slug` behandeln, alles andere mit 200 quittieren
- [ ] `checkout.session.completed`: Subscription und Customer laden → `instance-request` dispatchen mit `slug`, `plan`, `company`, `contact`, `email`, `city`, `stripeCustomer`, `stripeSubscription`, `auto` → Betreiber-Mail
- [ ] `customer.subscription.updated` / `.deleted`, `invoice.paid`: gewünschten Tarif bestimmen → `plan-sync` dispatchen (`slug`, `plan`, `reason`)
- [ ] `invoice.payment_failed`: Betreiber-Mail (Kunde, Betrag, Versuch, nächster Versuch)
- [ ] Dispatch fehlgeschlagen → HTTP 500, damit Stripe es erneut zustellt (bis zu 3 Tage)
- [ ] `lib/dispatch.js`: `event_type` als Parameter
- [ ] Tests: Signatur mit `stripe.webhooks.generateTestHeaderString`, Tarif-Ableitung je Status, falscher Modus, fremde Events, Dispatch-Fehler → 500

## Phase 3 – Infrastruktur (Landing)

- [ ] `nginx.conf`: `location = /api/stripe/webhook` → request-api, nur POST, `client_max_body_size 64k`, Body unverändert durchreichen
- [ ] `docker-compose.yml`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_URL`, `PUBLIC_SITE_URL` an request-api
- [ ] README: Abschnitt „Betrieb: Stripe“ (Konto, Schlüssel, Webhook, Sandbox/Live, Stripe CLI)

## Phase 4 – GitHub-Workflows (Landing)

- [ ] `deploy-instance.yml` aufteilen: Deploy-Job als wiederverwendbarer Workflow (`on: workflow_call`, Eingaben `slug`, `plan`, `email`, `send_mail`, `issue_number`). Der `issue_comment`-Trigger mit `/approve` ruft ihn auf. (Nötig, weil Kommentare des Bots mit `GITHUB_TOKEN` keine Workflows auslösen.)
- [ ] `new-request.yml`: Stripe-IDs in Issue-Tabelle und `deploy-params`; ist `auto` gesetzt → Deploy-Workflow direkt aufrufen, Issue-Text „wird automatisch deployt“; `AUTO_DEPLOY_FREE` beachten
- [ ] Doppelte Zustellung: Vor dem Anlegen nach offenem oder geschlossenem Issue mit derselben `stripeSubscription` suchen; gibt es eins, nichts tun
- [ ] Neuer Workflow `plan-sync.yml` (`repository_dispatch: [plan-sync]`): Eingaben prüfen → `manage.sh set-plan <slug> <plan> true`; Concurrency-Gruppe `deploy-instance`; bei Fehler Issue mit Label `billing-sync-failed`
- [ ] `change-plan.yml` (manuell) bleibt, Hinweis in der Beschreibung: Tarif lieber im Stripe-Dashboard ändern, sonst setzt der nächste Webhook ihn zurück
- [ ] Deploy-Fehler im Auto-Modus (z. B. Slug existiert schon): Issue bleibt offen, Label `deploy-failed`, Kommentar mit `/approve slug=…` als Lösung

## Phase 5 – OpenBills-Repo (dieser Branch)

- [ ] `manage-instances.sh set-plan`: Ist der Tarif schon gesetzt → „unverändert“, Exit 0, kein Neustart, keine Mail
- [ ] `deploy-instance.sh --auto`: optionaler Parameter `--upgrade-contact <url>`; Default aus `.env.platform` (`PLATFORM_BILLING_PORTAL_URL`)
- [ ] `manage-instances.sh set-upgrade-contact <name|all> <url>` für Bestandsinstanzen
- [ ] Upgrade-Dialog: Ist der Kontakt eine URL → Button „Tarif verwalten“ statt „Kontakt“
- [ ] Mail beim Tarifwechsel: Hinweis, dass Rechnung und Zahlung über Stripe laufen, mit Portal-Link
- [ ] README / CLAUDE.md: Abschnitt „Tarife (Managed SaaS)“ um Stripe ergänzen

## Phase 6 – Website und Rechtstexte (Landing)

- [ ] Formular `/anfrage/`: nach Erfolg auf `checkoutUrl` weiterleiten; Button-Text je Tarif („Weiter zur Zahlung“ / „Kostenlos starten“); Hinweis bei `?abgebrochen=1`
- [ ] Neue Seite `/anfrage/danke/`: „Deine Instanz wird eingerichtet, die Mail kommt in wenigen Minuten“ (Free: „sobald wir freigeschaltet haben“)
- [ ] `src/config/site.ts`: `billingPortalUrl`; Link „Abo verwalten“ im Footer und auf `/preise/`
- [ ] `src/data/plans.ts` → `planTerms`: „Wie bezahle ich?“ (Karte oder SEPA-Lastschrift, monatliche Rechnung per Mail über Stripe), „Kann ich den Tarif wechseln?“ und „Wie kann ich kündigen?“ (im Kundenportal)
- [ ] `src/content/terms.ts` § 4 Preise und Zahlung (Zahlungsdienstleister, Zahlungsweise, Fälligkeit, Teilmonat, Folgen eines Zahlungsausfalls: Herabstufung auf Free), § 6 (Kündigung im Portal oder in Textform); Version der Bedingungen erhöhen
- [ ] Datenschutzerklärung: Stripe Payments Europe Ltd. (Irland) als Zahlungsdienstleister, Zweck, Rechtsgrundlage Art. 6 Abs. 1 lit. b DSGVO, Drittlandtransfer (Stripe Inc., USA, EU-US Data Privacy Framework). Stripe verarbeitet keine Daten aus den Instanzen, gehört also nicht in die Liste der Unterauftragnehmer im AVV.
- [ ] Tests: `plans.test.ts` und SEO-Prüfung für die neue Seite

## Phase 7 – Tests in der Sandbox (ohne echtes Geld)

- [ ] Lokal: `stripe listen --forward-to localhost:3001/api/stripe/webhook`, `stripe trigger checkout.session.completed`
- [ ] End-to-End gegen den Host mit Sandbox-Schlüsseln:
  1. Free anfragen (keine Zahlungsdaten) → Issue → `/approve` → Instanz läuft
  2. Im Portal auf Starter upgraden (Testkarte `4242 4242 4242 4242`) → `plan-sync` → Instanz auf `starter`
  3. Professional direkt buchen (SEPA-Test-IBAN `DE89 3704 0044 0532 0130 00`) → Deploy ohne `/approve`
  4. Downgrade auf Free → bleibt bis Monatsende, dann `free` (Test Clock vorspulen)
  5. Zahlungsausfall: Karte `4000 0000 0000 0341` → Mahnlauf per Test Clock → `unpaid` → `free` → Rechnung bezahlen → Tarif zurück
  6. Webhook doppelt zustellen (Dashboard → „Erneut senden“) → kein zweites Issue, kein Neustart
- [ ] Rechnungs-PDF prüfen: Name und Anschrift beider Seiten, Nummer, Datum, Leistung, Zeitraum, Betrag, § 19-Hinweis
- [ ] Test-Instanzen danach mit `remove` aufräumen

## Phase 8 – Livegang

- [ ] Stripe-Konto aktiviert (Verifizierung abgeschlossen), Produkte, Portal und Webhook im Live-Modus anlegen (Sandbox-Einstellungen werden nicht übernommen)
- [ ] Live-Schlüssel und Webhook-Secret setzen, `docker compose up -d --build`
- [ ] Rechtstexte live, Version erhöht
- [ ] Bestandskunden (falls vorhanden): je Kunde Customer mit `metadata.slug` anlegen und einen Checkout-Link schicken, oder das Abo im Dashboard mit Stichtag 1. des Folgemonats anlegen; danach `set-upgrade-contact all`
- [ ] Erste echte Buchung selbst durchspielen (Starter, danach erstatten und auf Free stellen)

## Offene Punkte

- Verlangt das Portal beim Upgrade von Free (ohne gespeicherte Zahlungsmethode) automatisch eine Zahlungsmethode? In der Sandbox prüfen. Falls nicht: Upgrade von Free per eigenem Checkout-Link („Tarif buchen“ im Upgrade-Dialog).
- SEPA: Das Abo ist aktiv, bevor die Lastschrift durch ist (einige Tage). Deploy trotzdem sofort; ein späterer Ausfall läuft über den normalen Mahnlauf.
