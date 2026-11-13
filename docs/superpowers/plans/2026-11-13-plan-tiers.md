# Umsetzungsplan Plan-Tiers

Spec: `docs/superpowers/specs/2026-11-13-plan-tiers.md`

## Phase 1 – Backend ✅ (2026-11-13)

- [x] `backend/utils/plan.js`: Matrix, `resolvePlanName` (Startfehler bei unbekanntem Wert), `hasFeature`, `getLimit`, `currentPeriod` (Europe/Berlin), `PlanError`, `requireFeature`, `sendPlanError`
- [x] `backend/services/quotaService.js`: `countReleaseIfNeeded` (in Transaktion, `FOR UPDATE`), `assertCustomerSlotAvailable`, `getUsage`
- [x] Migration `005_plan_usage`: `usage_counters`, `quota_counted_at` auf invoices/quotes, Backfill Bestand
- [x] Zählung in `createInvoice`/`updateInvoice`/`createQuote`/`updateQuote`
- [x] `GET /api/plan`
- [x] Gates: `/api/email` (alles), `/api/jobs`, `/api/reminders`, `/api/material-templates`, `/api/customers/:id/{hourly-rates,materials}` (Schreiben), `/api/reporting/invoice-journal`; Statistik im Basis-Plan nur laufendes Jahr, ohne Top-Kunden
- [x] Kundenlimit in `POST /api/customers`
- [x] Tests `backend/tests/plan.test.js`; Smoke-Test gegen echtes Postgres

## Phase 2 – Entwurfs-Wasserzeichen ✅ (2026-11-13)

- [x] `src/utils/pdf/draftWatermark.ts`: „ENTWURF“ auf Rechnungs- und Angebots-PDF bei `status === 'draft'`; Rechnungsentwurf ohne eingebettetes ZUGFeRD-XML
- [x] XRechnung für Entwürfe: Generator wirft `DraftExportError`; `DownloadModal` sperrt Option ohne „als versendet markieren“
- [x] `src/utils/releaseForOutput.ts`: Entwurf vor Versand/Download freigeben, Rollback bei Fehler; eingesetzt in InvoiceManagement (Mail einzeln/Bulk, Download einzeln/Bulk), Dashboard, QuoteManagement (Mail einzeln/Bulk)
- [x] Backend `utils/draftWatermark.js` (`pdf-lib`): Stempel + Entfernen eingebetteter Dateien; `routes/email.js` liest Status aus DB, blockiert XRechnung-Entwürfe (400); `POST /quotes/:id/send-email` mit `requireFeature('email')` und Stempel
- [x] Tests: `backend/tests/draftWatermark.test.js`, `src/utils/pdf/__tests__/draftWatermark.test.ts`; visuelle Prüfung; API-Smoke-Test

## Phase 3 – Frontend ✅ (2026-11-13)

- [x] `api.ts`: `getPlan()`; 402/403 mit `code` → `PlanError` + Event `belego:plan-error`
- [x] `PlanContext` (lädt `/api/plan`, `hasFeature`, `isManaged`, aktualisiert bei Datenänderung; öffnet Upgrade-Dialog bei jedem Tarif-Fehler)
- [x] `UpgradeDialog` mit `upgradeContact` (mailto/tel/URL), `PlanLockedNotice`, `PlanUsage` (Sidebar, nur Managed)
- [x] Navigation: Schloss bei Aufträgen/Kalender/Mahnungen; Seiten zeigen Sperrhinweis
- [x] E-Mail-Buttons (Rechnung/Angebot einzeln+Bulk, Dashboard) öffnen ohne Feature den Upgrade-Dialog; Fehler-Alerts unterdrückt bei `PlanError`
- [x] Reporting Basis: Journal gesperrt, keine Jahresauswahl, keine Top-Kunden
- [x] Kundenspezifische Preise (Kundenformular) und Materialvorlagen (Einstellungen) gesperrt

## Phase 4 – Betrieb ✅ (2026-11-13)

- [x] `deploy-instance.sh`: Tarif-Auswahl (interaktiv, 1–5) + Upgrade-Kontakt; Legacy-Modus mit optionalem 5. Argument `[plan]`, validiert
- [x] `manage-instances.sh list`: Tarif je Instanz
- [x] README-Abschnitt „Tarife (Managed SaaS)“, CLAUDE.md-Abschnitt „Plan-Tiers“
