# Belegarchiv, Sperre und Storno – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ausgegebene Belege werden als Originalfassung archiviert, freigegebene Rechnungen sind serverseitig gesperrt, Korrekturen laufen über Stornorechnungen (`ST-`), und das Archiv lässt sich als lesbares ZIP exportieren (App und Betreiber-Skript).

**Architecture:** Neue Tabelle `document_archive` (append-only, ohne FK) mit Service `backend/services/archiveService.js` und Route `/api/archive`. Die Sperre sitzt in `invoiceService.updateInvoice/deleteInvoice`. Storno ist ein eigener Service (`cancellationService.js`) mit `POST /api/invoices/:id/cancel`. Das Frontend lädt beim Download die erzeugte Datei über einen Helper ins Archiv; beim Mailversand archiviert das Backend. Der Export wird serverseitig mit adm-zip gebaut; fehlende Fassungen erzeugt das Frontend vorher.

**Tech Stack:** Node 24 / Express (ESM), PostgreSQL 15, adm-zip, Vitest; React 18 + TS, jspdf, pdf-lib.

**Spec:** `docs/superpowers/specs/2026-11-17-document-archive-storno.md`

## Global Constraints

- Gesperrt = Rechnung mit `status <> 'draft'`. Gilt in allen Tarifen inkl. Self-Hosted.
- Fehlercode Sperre: HTTP 409, `{ code: 'INVOICE_LOCKED', error: <deutscher Text> }`.
- Storno-Nummern `ST-YYYY-NNN`, eigener Kreis, Start 1, keine Startnummern-Tabelle.
- E-Rechnung Storno: BT-3 = 384, BG-3 mit BT-25 + BT-26, Mengen negativ, Einzelpreise positiv, Summen = negierte Originalwerte.
- Stornorechnungen zählen nicht gegen das Kontingent.
- Archiv nie für Entwürfe. Deduplizierung über `(document_type, document_id, format, sha256)`.
- `document_archive` ist optional im Backup (Default aus).
- Archiv-Export in allen Tarifen, nur für Admins.
- UI-Texte deutsch, Strict TS. Backend ESM mit `.js`-Imports. Route-Handler behalten ihr eigenes try/catch (ADR 0001).
- Tests nur in Docker: **BTEST** / **FTEST** wie in `docs/superpowers/plans/2026-11-13-auth.md` („Testlauf“), DB-Tests mit `describe.skipIf(!hasDb)`.

## Review Focus

- Rückweg `sent → draft` in `releaseForOutput`: muss gehen, solange kein Archiveintrag existiert; nach erfolgreichem Download (Archiv geschrieben) nicht mehr. Test in Task 3.
- Frontend schickt beim Statuswechsel ganze Rechnungsobjekte (inkl. Positionen, Datumsformaten, Anhängen ohne `content`). Der Vergleich in der Sperre muss normalisieren (Datum als `YYYY-MM-DD`, Zahlen numerisch, Anhänge per id), sonst schlägt jeder Statuswechsel mit 409 fehl. Test mit echtem Frontend-Payload in Task 3.
- `generateInvoiceNumber` sucht `ORDER BY created_at DESC` per `LIKE`. Mit `ST-` darf ein ST-Beleg nie den RE-Kreis beeinflussen und umgekehrt. Test in Task 4.
- Storno einer Rechnung mit Gesamtrabatt und mehreren Steuersätzen: Summen exakt negiert, KoSIT-valide. Test in Task 4 und Task 6.
- Restore eines Backups ohne Archiv in eine Instanz mit Archiv: Archiv bleibt. Mit Archiv: wird ersetzt, trotz Append-only-Trigger. Test in Task 9.
- Mailversand mit mehreren Formaten (`send-invoice-multi`): jede Datei einzeln archiviert, Entwurf (Wasserzeichen) nie. Test in Task 2.

---

### Task 1: Migration 015

**Files:**
- Create: `backend/migrations/015_document_archive.js`
- Modify: `backend/migrations/index.js` (falls Migrationen dort registriert werden)
- Modify: `backend/utils/backupTables.js` (`OPTIONAL_TABLES = ['document_archive']`)
- Modify: `backend/tests/backupRestore.test.js` (Vollständigkeit über drei Listen)
- Test: `backend/tests/migration015.test.js`

**Interfaces:**
- Produces: Tabelle `document_archive` (Spalten laut Spec, `UNIQUE (document_type, document_id, format, sha256)`, Index auf `(document_type, document_id)`), Trigger `document_archive_append_only` (UPDATE und DELETE immer verboten), `invoices.invoice_type VARCHAR(20) NOT NULL DEFAULT 'invoice' CHECK IN ('invoice','cancellation')`, `invoices.cancels_invoice_id UUID REFERENCES invoices(id)` (unique, wenn nicht NULL), `invoices.cancellation_reason TEXT`. Status-CHECK von `invoices` um `'cancelled'` erweitert (Constraint-Name vorher per `pg_constraint` ermitteln, nicht raten).

- [x] **Step 1:** Failing test: Migration läuft; Insert `invoices.status = 'cancelled'` geht; UPDATE/DELETE auf `document_archive` wirft; Doppel-Insert gleicher Hash wirft 23505.
- [x] **Step 2:** Migration mit `up`/`down` schreiben, BTEST grün.
- [x] **Step 3:** `backupTables.js` + Vollständigkeitstest anpassen.
- [x] **Step 4:** Commit.

### Task 2: Archiv-Service und -Route

**Files:**
- Create: `backend/services/archiveService.js`, `backend/routes/archive.js`
- Modify: `backend/server.js` (`/api/archive`)
- Modify: `backend/routes/email.js` (`send-invoice`, `send-invoice-multi`, `send-reminder`), `backend/routes/quotes.js` (`/:id/send-email`)
- Test: `backend/tests/archive.test.js`

**Interfaces:**
- Produces: `archiveDocument(client|null, { documentType, documentId, format, filename, contentType, contentBase64, source, reminderStage, userId }) → { id, created: boolean }`. Lädt Nummer, Kunde, Datum, Summe selbst aus der DB (Schnappschuss). Wirft 409 bei Entwurf, 404 bei unbekanntem Beleg. Dedupliziert per `INSERT … ON CONFLICT DO NOTHING`.
- `listArchive({ documentType, documentId })`, `getArchiveFile(id)`, `countMissing() → { invoices: [ids], quotes: [ids] }` (freigegebene Belege ohne `pdf`-Fassung).
- Routen: `POST /api/archive`, `GET /api/archive`, `GET /api/archive/missing`, `GET /api/archive/:id/download` (Audit `archive.downloaded`).
- Mailrouten archivieren **nach** erfolgreichem Versand und nur, wenn der Beleg nicht `draft` ist; ein Archivfehler lässt den Versand nicht scheitern, wird aber geloggt.

- [x] **Step 1:** Failing tests: Ablage, Deduplizierung (`created: false`), Entwurf → 409, Liste ohne `content`, Download liefert Datei + Audit; Mailroute mit gemocktem Transport archiviert jede Datei, Entwurf nicht.
- [x] **Step 2:** Implementieren, BTEST grün.
- [x] **Step 3:** Commit.

### Task 3: Sperre nach Freigabe

**Files:**
- Modify: `backend/services/invoiceService.js` (`updateInvoice`, `deleteInvoice`)
- Modify: `backend/routes/invoices.js` (409 durchreichen)
- Create: `backend/utils/invoiceLock.js` (Vergleich/Normalisierung)
- Test: `backend/tests/invoiceLock.test.js`

**Interfaces:**
- Produces: `assertUpdateAllowed(current, currentItems, currentAttachments, updateData, hasArchive)`: wirft `{ statusCode: 409, code: 'INVOICE_LOCKED' }`. Regeln:
  - `current.status === 'draft'` → alles erlaubt.
  - `current.status === 'cancelled'` → nichts.
  - Sonst nur `status` ∈ `sent|paid|overdue|reminded_1x|reminded_2x|reminded_3x`; `draft` nur, wenn `!hasArchive`; `cancelled` nur über den Storno-Service (nie per PUT).
  - Andere Felder: erlaubt, wenn sie nach Normalisierung dem gespeicherten Wert entsprechen.
- `deleteInvoice` wirft 409, wenn nicht `draft`.

- [x] **Step 1:** Failing tests: Positionsänderung 409; Payload aus Frontend (`InvoiceContext.updateInvoice` mit vollem Objekt, nur Status geändert) → 200; `sent → draft` ohne Archiv 200, mit Archiv 409; `paid → sent` 200; `cancelled` → alles 409; Löschen `sent` 409, `draft` 200.
- [x] **Step 2:** Implementieren, BTEST grün.
- [x] **Step 3:** Bestehende Tests prüfen (`documentChain.test.js` u. a. bearbeiten ggf. freigegebene Rechnungen) und anpassen.
- [x] **Step 4:** Commit.

### Task 4: Nummernkreis ST und Storno-Service

**Files:**
- Modify: `backend/services/invoiceService.js` (`generateInvoiceNumber(issueDate, prefix = 'RE')`; Startnummer-Tabelle nur bei `RE`)
- Create: `backend/services/cancellationService.js`
- Modify: `backend/routes/invoices.js` (`POST /:id/cancel`)
- Modify: `backend/queries/invoiceQueries.js` (`invoiceType`, `cancelsInvoiceId`, `cancelledByInvoice { id, invoiceNumber }`, `cancellationReason`)
- Test: `backend/tests/cancellation.test.js`

**Interfaces:**
- Produces: `cancelInvoice(id, { reason, releaseSources = true, userId }) → { original, cancellation }`. Ablauf laut Spec § 3 in einer Transaktion (`SELECT … FOR UPDATE` auf das Original), Nummer mit Retry bei 23505 wie in `createInvoice`. `quota_counted_at = NOW()` direkt setzen, `countReleaseIfNeeded` nicht aufrufen. Audit `invoice.cancelled`.
- Fehler: Entwurf, schon storniert, Stornorechnung selbst → 409 `INVOICE_NOT_CANCELLABLE`; `reason` leer oder > 500 → 400.
- `releaseSources = false` wird vom Frontend für „Stornieren und neu erstellen“ genutzt; danach hängt das Frontend die Quellen per bestehendem Job-/Quote-Update auf den neuen Entwurf um. Falls das bestehende API dafür nicht reicht: `POST /:id/cancel` nimmt optional `replacementInvoiceId` und hängt in derselben Transaktion um.

- [x] **Step 1:** Failing tests: `ST-2026-001` beim ersten Storno, `ST-2026-002` beim zweiten, RE-Kreis unverändert; Positionen negiert; Summen exakt negiert (Rechnung mit Positionsrabatt, Gesamtrabatt, 7 % + 19 %); beide Status `cancelled`; Aufträge `invoice_id NULL`/`completed`, Angebot `accepted`; Kontingent unverändert bei ausgeschöpftem Free-Limit; doppeltes Storno 409.
- [x] **Step 2:** Implementieren, BTEST grün.
- [x] **Step 3:** Commit.

### Task 5: Folgewirkungen Status `cancelled`

**Files:**
- Modify: `src/types/index.ts` (`InvoiceStatus` + `'cancelled'`, `Invoice.invoiceType`, `cancelsInvoiceId`, `cancelledByInvoice`, `cancellationReason`)
- Modify: `src/utils/documentFlow.ts`, `src/components/Dashboard.tsx`, `src/components/ReminderManagement.tsx` (Überfälligkeit/offen ohne `cancelled`)
- Modify: `backend/routes/reporting.js` (offen/überfällig ohne `cancelled`, Statusverteilung, `statusMap` im Journal-PDF „Storniert“)
- Modify: Status-Badges/Labels (Suche nach `reminded_3x` im Frontend für alle Label-Maps)
- Test: bestehende Frontend-Tests zu `documentFlow` erweitern; `backend/tests/reporting…` falls vorhanden, sonst in `cancellation.test.js`

- [x] **Step 1:** Failing tests: stornierte Rechnung nie überfällig/offen; Journal enthält beide Belege, Umsatzsumme netto 0.
- [x] **Step 2:** Implementieren, FTEST/BTEST grün, `docker compose … build frontend` ohne TS-Fehler.
- [x] **Step 3:** Commit.

### Task 6: PDF und E-Rechnung für Stornorechnungen

**Files:**
- Modify: `src/utils/pdfGenerator.ts` (Titel „Stornorechnung“, Bezugszeile „Storno zur Rechnung RE-… vom …“, Grund; Generatoren sperren nur `draft`)
- Modify: `src/utils/pdf/zugferdGenerator.ts` (TypeCode 384, `ram:InvoiceReferencedDocument` mit `IssuerAssignedID` + `FormattedIssueDateTime`)
- Modify: `src/utils/pdf/xrechnungGenerator.ts` (TypeCode 384, `cac:BillingReference/cac:InvoiceDocumentReference` mit `cbc:ID` + `cbc:IssueDate`)
- Test: `src/utils/pdf/__tests__/cancellationXml.test.ts`

**Interfaces:**
- Consumes: `Invoice.invoiceType === 'cancellation'` und Originaldaten (`cancelsInvoice { invoiceNumber, issueDate }` — in Task 4 mit ausliefern).

- [x] **Step 1:** Failing tests: XML beider Formate enthält 384, Referenz mit Nummer + Datum, `BilledQuantity`/`InvoicedQuantity` negativ, `ChargeAmount`/`PriceAmount` positiv, Gesamtsumme negativ und gleich der negierten Originalsumme; normale Rechnung unverändert 380 ohne Referenz.
- [x] **Step 2:** Implementieren, FTEST grün.
- [x] **Step 3:** KoSIT-Validator in Docker (aktuelle Release von `itplr-kosit/validator` + `validator-configuration-xrechnung`) gegen Beispiel-Storno beider Formate (ZUGFeRD-XML aus der PDF extrahiert). Ergebnis und Versionen im PR vermerken. Bei Fehlern: Generator anpassen, nicht die Regel umgehen.
  - Ergebnis (2026-11-18): Validator 1.6.3, `xrechnung-3.0.2-validator-configuration-2026-08-31`, `scripts/kosit-validate.sh` → 10/10 ACCEPT (Rechnung + Storno gemischt, 19 %, Kleinunternehmer, Reverse Charge; je UBL + CII). Das CII-XML wird direkt aus `generateZUGFeRDXML` geprüft – `embedZUGFeRDXMLIntoPDF` bettet genau diesen String ein.
  - Erster Lauf: Original und Storno abgelehnt mit BR-CO-15 und BR-S-08 (CII) – bestehender Rundungsfehler aller E-Rechnungen, nicht Storno-spezifisch. Behoben in Task 6a.
- [x] **Step 4:** Commit.

### Task 6a: Cent-genaue Summen und E-Rechnung (eingeschoben)

Anlass: KoSIT-Lauf in Task 6. Summen wurden mit ungerundeter Steuer gebildet (BR-CO-15), Steuergruppen aus ungerundeten Positionsbeträgen (BR-S-08); Reverse Charge ohne Käufer-USt-ID (BR-AE-02).

**Files:** `src/utils/discountUtils.ts`, `backend/utils/documentTotals.js`, `backend/services/documentTotalsService.js` (neu), `backend/services/invoiceService.js`, `backend/services/quoteService.js`, `src/utils/pdf/xrechnungGenerator.ts`, `src/utils/pdf/zugferdGenerator.ts`, `src/utils/pdf/xmlUtils.ts`, `scripts/kosit-validate.sh` (neu), Tests: `centTotals.test.ts`, `documentTotalsParity.test.ts`, `kositSamples.test.ts`, `backend/tests/documentTotals.test.js`

- [x] **Step 1:** Summen Cent-genau: Position netto = gerundeter Betrag − gerundeter Rabatt, Gesamtrabatt je Steuersatz verteilt (Rest-Cent auf den größten Satz), Steuer je Satz gerundet, Gesamtbetrag = Netto + Steuer. Frontend und Backend identisch (Paritätstest inkl. Steuergruppen und Positionen).
- [x] **Step 2:** Backend speichert Rechnungen/Angebote mit diesen Summen (Rabattbeträge aus Typ/Wert, Kleinunternehmer der Firma), nicht mit Client-Werten. Altdaten: Rabattbetrag ohne Typ = Festrabatt.
- [x] **Step 3:** XML-Generatoren leiten alle Beträge aus der Berechnung ab (auch Altrechnungen gültig; dort ggf. 1 Cent Abweichung zum gespeicherten Betrag/PDF). Käufer-USt-ID (BT-48) bei Präfix-Format.
- [x] **Step 4:** `scripts/kosit-validate.sh` + Beispiele, 10/10 ACCEPT.
- [x] **Step 5:** Commit.

### Task 7: Frontend – Archivierung beim Download, Sperre, Storno

**Files:**
- Create: `src/utils/archiveOutput.ts` (`archiveAndDownload(doc, documentType, format, blob, filename, reminderStage?)`: lädt hoch, wenn nicht Entwurf, dann `downloadBlob`)
- Modify: `src/services/api.ts` (`archiveDocument`, `getArchive`, `getArchiveMissing`, `archiveDownloadUrl`, `cancelInvoice`, `exportArchiveUrl`)
- Modify: `src/components/InvoiceManagement.tsx` (Download-Pfade über Helper; gesperrte Rechnung: Bearbeiten/Löschen weg, „Stornieren“, „Stornieren und neu erstellen“; GoBD-Hinweise Zeilen ~180/210 entfernen; Anzeige „Storniert“/„Stornorechnung zu …“)
- Modify: `src/components/QuoteManagement.tsx`, `src/components/ReminderManagement.tsx`, `src/components/ReminderSendModal.tsx`, `src/components/DownloadModal.tsx`, `src/components/Dashboard.tsx` (Download-Pfade über Helper)
- Create: `src/components/CancelInvoiceModal.tsx` (Grund Pflicht, Checkbox „Aufträge und Angebot wieder zur Abrechnung freigeben“, Hinweis bei bezahlter Rechnung)
- Create: `src/components/ArchiveVersions.tsx` (Liste in der Rechnungs-/Angebotsdetailansicht)
- Test: `src/utils/__tests__/archiveOutput.test.ts`

- [ ] **Step 1:** Failing test: Helper archiviert vor dem Download; Entwurf wird nicht archiviert; Archivfehler bricht den Download ab (sonst kein Nachweis) und `releaseForOutput` setzt zurück.
- [ ] **Step 2:** Helper + API + Umbau aller Download-Stellen (Grep auf `downloadBlob(` als Checkliste; Vorschau in `DocumentPreview.tsx` bleibt ohne Archiv).
- [ ] **Step 3:** Sperr-UI und Storno-Dialoge. „Stornieren und neu erstellen“: Storno mit `releaseSources: false`, Kopie als Entwurf anlegen, Quellen umhängen, Editor öffnen.
- [ ] **Step 4:** Frontend-Build (TS + ESLint) grün; manuell in einer Testinstanz: Rechnung freigeben, herunterladen, Archivfassung sichtbar, Bearbeiten nicht möglich, Storno erzeugen, Storno-PDF/XML herunterladen.
- [ ] **Step 5:** Commit.

### Task 8: Archiv-Export

**Files:**
- Create: `backend/services/archiveExportService.js` (`buildArchiveZip({ from, to }) → Buffer`)
- Modify: `backend/routes/archive.js` (`GET /export`, Admin, Audit `archive.exported`)
- Create: `src/components/settings/ArchivExportSection.tsx` (oder in die bestehende Daten-/Backup-Sektion integrieren; dort nachsehen, wo `BackupManagement.tsx` eingebunden ist)
- Test: `backend/tests/archiveExport.test.js`

**Interfaces:**
- ZIP laut Spec § 4: `LIESMICH.txt`, `index.csv`, `rechnungen/`, `angebote/`, `mahnungen/`, `anhaenge/`, `kunden.csv`, `rechnungsjournal.csv`. CSV: UTF-8 mit BOM, `;`, Dezimalkomma, Datum `TT.MM.JJJJ`. Dateinamen sanitisiert (keine `/`, `..`). Mehrere Fassungen gleicher Datei: Suffix `_2`, `_3` nach `created_at`.
- Frontend-Dialog: Zeitraum, Anzahl fehlender Fassungen (`GET /api/archive/missing`), „Fehlende Fassungen erzeugen“ (PDF für Rechnungen/Angebote, ZUGFeRD-PDF für Rechnungen, `source: 'regenerated'`, Fortschrittsanzeige), dann Download.
- Kein Plan-Gating (alle Tarife).

- [ ] **Step 1:** Failing tests: ZIP-Struktur, CSV-Kopfzeilen und BOM, Storno im Journal mit Bezug, Zeitraumfilter, Nicht-Admin 403, Pfad-Sanitizing.
- [ ] **Step 2:** Implementieren, BTEST grün.
- [ ] **Step 3:** Frontend-Dialog, Build grün, manuell mit Altbeleg ohne Fassung testen.
- [ ] **Step 4:** Commit.

### Task 9: Optionales Archiv im Backup

**Files:**
- Modify: `backend/routes/backup.js` (`create-zip` mit `includeArchive`; `metadata.includesArchive`; Restore ersetzt Archiv nur bei `includesArchive`, Trigger in der Transaktion per `ALTER TABLE … DISABLE/ENABLE TRIGGER`; neue Route `GET /api/backup/size-estimate → { baseBytes, archiveBytes }`)
- Modify: `src/components/BackupManagement.tsx` (Checkbox, Größenanzeige, Warnung > 500 MB, Checkbox dann gesperrt, Link zum Archiv-Export)
- Modify: `backend/tests/backupRestore.test.js`

- [ ] **Step 1:** Failing tests: Backup ohne Option enthält kein Archiv; mit Option schon; Restore ohne Archiv lässt vorhandenes Archiv stehen; Restore mit Archiv ersetzt es; Größenschätzung.
- [ ] **Step 2:** Implementieren, BTEST grün, Frontend-Build grün.
- [ ] **Step 3:** Commit.

### Task 10: Betreiber-Skript und Lösch-Workflow

**Files:**
- Create: `backend/scripts/archiveExport.js` (ruft `buildArchiveZip`, schreibt nach stdout oder Pfad, meldet Anzahl fehlender Fassungen auf stderr)
- Modify: `manage-instances.sh` (`archive-export <name>` → `backups/archiv_<name>_<timestamp>.zip`; `remove` fragt vorher „Archiv-Export erstellen? [J/n]“, bei `--yes` automatisch ja)
- Modify: `backend/tests/scripts.test.js`

- [ ] **Step 1:** Failing test: Skript erzeugt gültiges ZIP und meldet fehlende Fassungen.
- [ ] **Step 2:** Implementieren, BTEST grün; `manage-instances.sh archive-export <test>` manuell gegen eine lokale Instanz.
- [ ] **Step 3:** Commit.

### Task 11: Dokumentation

**Files:**
- Modify: `CLAUDE.md` (Abschnitt „Belegarchiv und Storno“: Tabelle, Sperre, `ST-`-Kreis, 384, Export, Skript; Verweis auf Spec)
- Modify: `docs/superpowers/specs/2026-11-13-plan-tiers.md` (Zeile „Archiv-Export ✓“ in allen Spalten)
- Modify: Hilfe-/FAQ-Texte im Frontend, falls dort Bearbeiten freigegebener Rechnungen beschrieben ist (Grep „GoBD“)
- Modify: `CLAUDE.md` (Abschnitt eRechnung/Belegkette: Summen Cent-genau, `documentTotalsService.js`, `scripts/kosit-validate.sh`)

- [ ] **Step 1:** Doku anpassen.
- [ ] **Step 2:** Commit.

### Task 12: Kunden archivieren statt löschen

Hintergrund: Seit der Sperre (Task 3) antwortet `DELETE /api/customers/:id` mit 409 `CUSTOMER_HAS_INVOICES`, sobald freigegebene oder stornierte Rechnungen existieren (`invoices.customer_id` ist `ON DELETE CASCADE`). Echtes Löschen geht nicht: Rechnungen speichern nur `customer_name`, Adresse/USt-ID/E-Mail für Storno-XML, Mahnungen und „Fehlende Fassungen erzeugen“ kommen vom Kunden. Archivieren entspricht der Sperrung nach Art. 17 Abs. 3 lit. b DSGVO während der Aufbewahrungsfrist.

**Files:**
- Create: `backend/migrations/016_customer_archive.js` (`customers.archived_at TIMESTAMPTZ NULL`), Registrierung in `backend/migrations/index.js`
- Modify: `backend/routes/customers.js` (`POST /:id/archive`, `POST /:id/unarchive`, Audit `customer.archived`/`customer.unarchived`; Liste liefert `archivedAt`; `DELETE` bleibt bei 409 für Kunden mit freigegebenen Rechnungen)
- Modify: `backend/services/invoiceService.js`, `backend/services/quoteService.js`, Auftragsanlage in `backend/routes/jobs.js` (neue Belege für archivierte Kunden → 409 `CUSTOMER_ARCHIVED`; Storno einer Rechnung eines archivierten Kunden bleibt erlaubt)
- Modify: `src/types/index.ts` (`Customer.archivedAt?`), `src/services/api.ts`, `src/context/CustomerContext.tsx`
- Modify: `src/components/CustomerManagement.tsx` (Filter „Archivierte anzeigen“, Aktionen „Archivieren“/„Wiederherstellen“; bei 409 `CUSTOMER_HAS_INVOICES` Archivieren anbieten)
- Modify: Kundenauswahl in Editoren (Grep `customers.map`/`customers.filter` in `InvoiceEditor`, `QuoteEditor`, `JobEntryForm`, `JobInvoiceGenerator` u. a.): archivierte Kunden ausblenden, außer der Beleg gehört bereits zu ihnen
- Test: `backend/tests/customerArchive.test.js`

- [ ] **Step 1:** Failing tests: Archivieren/Wiederherstellen mit Audit; archivierter Kunde in der Liste mit `archivedAt`; neue Rechnung/Angebot/Auftrag für archivierten Kunden 409; bestehende Rechnungen bleiben lesbar, Statuswechsel und Storno gehen; `DELETE` weiter 409 bei freigegebenen Rechnungen; Restore eines Backups ohne `archived_at` (alte Backups) funktioniert.
- [ ] **Step 2:** Implementieren, BTEST grün.
- [ ] **Step 3:** Frontend (Filter, Aktionen, Kundenauswahl), Build grün; manuell: Kunde mit Rechnung archivieren, taucht in Auswahl nicht mehr auf, Rechnung weiterhin herunterladbar.
- [ ] **Step 4:** `CLAUDE.md` (Abschnitt „Belegarchiv und Storno“) um Kunden-Archivierung ergänzen.
- [ ] **Step 5:** Commit.
