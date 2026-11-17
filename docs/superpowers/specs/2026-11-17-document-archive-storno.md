# Belegarchiv, Sperre nach Freigabe und Storno

Freigegebene Rechnungen werden unveränderbar. Jede ausgegebene Datei (PDF, ZUGFeRD, XRechnung) wird als Originalfassung archiviert. Korrekturen laufen nur noch über eine Stornorechnung. Das Archiv lässt sich jederzeit als ZIP mit normalen Dateien exportieren (auch im Free-Tarif und vor dem Löschen einer Instanz), damit Kunden ihre Belege ohne OpenBills lesen und die Aufbewahrungspflicht (§ 147 AO, GoBD) erfüllen können.

## Ziele / Nicht-Ziele

- Ziel: Originalfassung jedes ausgegebenen Belegs nachweisbar; Rechnungsinhalt nach Freigabe serverseitig gesperrt; vollständiger Storno-Weg; lesbarer Export.
- Nicht-Ziel: Teilstorno, Gutschriften ohne Bezug zu einer Rechnung, revisionssichere Archivierung im Sinne einer zertifizierten Lösung, Verfahrensdokumentation.

## 1. Belegarchiv

Migration `015_document_archive`, Tabelle `document_archive`:

| Spalte | Inhalt |
|---|---|
| `id` | UUID |
| `document_type` | `invoice` \| `quote` \| `reminder` |
| `document_id` | UUID des Belegs, **ohne Foreign Key** (Archiv überlebt das Löschen von Entwürfen/Angeboten) |
| `document_number` | Belegnummer zum Zeitpunkt der Ablage |
| `customer_name`, `issue_date`, `total` | Schnappschuss für Liste und Export-Index |
| `reminder_stage` | 1–3 bei `reminder`, sonst NULL |
| `format` | `pdf` \| `zugferd` \| `xrechnung` |
| `filename`, `content_type`, `size` | |
| `content` | Base64 (wie die Anhang-Tabellen) |
| `sha256` | Hash der Datei |
| `source` | `output` (beim Senden/Herunterladen) \| `regenerated` (nachträglich erzeugt, siehe 4.) |
| `created_at`, `created_by` | Zeitpunkt, Benutzer (NULL = System) |

- Eindeutig auf `(document_type, document_id, format, sha256)`: Wiederholtes Herunterladen derselben Fassung legt nichts Neues an.
- Append-only per Trigger wie `audit_log` (kein UPDATE/DELETE). Ausnahme: der Backup-Restore schaltet den Trigger in seiner Transaktion ab.
- **Im App-Backup nur optional**, Default aus. `document_archive` steht in einer neuen Liste `OPTIONAL_TABLES` in `backend/utils/backupTables.js` (der Vollständigkeitstest prüft dann drei Listen).
  - Backup-Dialog: Checkbox „Belegarchiv einschließen“ (aus). Daneben die geschätzte Größe (`SUM(size)` × 4/3 für Base64 plus Rest der DB). Über 500 MB (`client_max_body_size`) erscheint die Warnung: „Das Backup wäre größer als 500 MB und ließe sich nicht über die Oberfläche wiederherstellen. Laden Sie das Belegarchiv zuerst über ‚Archiv exportieren‘ separat herunter und erstellen Sie das Backup ohne Archiv.“ Die Checkbox ist dann gesperrt.
  - `metadata.json` vermerkt `includesArchive`. Restore: Enthält das ZIP das Archiv, wird es ersetzt (Trigger in der Transaktion aus). Sonst bleibt das vorhandene Archiv unverändert. Verwaiste Einträge sind dabei harmlos, weil es keinen FK gibt.

**Wann wird archiviert?**

| Ausgabe | Wer legt ab |
|---|---|
| Mailversand Rechnung/Angebot/Mahnung (`/api/email/send-*`, `/api/quotes/:id/send-email`) | Backend, nach erfolgreichem Versand, aus der mitgeschickten Datei |
| Download „als versendet“ (Rechnung, Angebot, Mahnung) | Frontend lädt die erzeugte Datei per `POST /api/archive` hoch, **bevor** der Browser-Download startet |
| Entwürfe (Wasserzeichen) | nie |

`POST /api/archive` prüft, dass der Beleg existiert und nicht `draft` ist. Body-Limit wie bisher (100 MB).

API (alle mit Login, Lesen für alle Rollen, Export nur Admin):
- `GET /api/archive?documentType=&documentId=` → Liste ohne `content`
- `GET /api/archive/:id/download` → Datei, Audit `archive.downloaded`
- `GET /api/archive/export?from=&to=` → ZIP (siehe 3.), Audit `archive.exported`

## 2. Sperre nach Freigabe (nur Rechnungen)

Eine Rechnung ist **gesperrt**, sobald ihr Status nicht `draft` ist. Durchgesetzt in `backend/services/invoiceService.js`:

- `updateInvoice`: Bei gesperrter Rechnung sind nur Statuswechsel erlaubt (`sent`, `paid`, `overdue`, `reminded_*`). Jedes andere Feld im Body, das vom gespeicherten Wert abweicht (Kunde, Daten, Positionen, Rabatte, Notizen, Anhänge), führt zu **409 `INVOICE_LOCKED`**. Gleiche Werte werden ignoriert, damit das Frontend weiter ganze Objekte schicken darf.
- **Zurück auf `draft`** nur, solange es für die Rechnung **keinen Archiveintrag** gibt. Das deckt den Rückweg in `releaseForOutput` ab: Schlägt die Ausgabe fehl, wurde noch nichts archiviert. Sonst 409 `INVOICE_LOCKED`.
- Statuswechsel aus `cancelled` heraus: nie (409).
- `deleteInvoice`: nur `draft`, sonst 409 `INVOICE_LOCKED`.
- Gilt in allen Tarifen inklusive Self-Hosted.
- Bestehende freigegebene Rechnungen sind ab dem Update sofort gesperrt.

Frontend (`InvoiceManagement.tsx`):
- Für gesperrte Rechnungen: „Bearbeiten“ und „Löschen“ entfallen, dafür „Stornieren“ und „Stornieren und neu erstellen“. Die GoBD-Hinweisfenster für Rechnungen (Zeilen 180/210) fallen weg.
- Statusänderung (bezahlt usw.) bleibt wie bisher.
- Detailansicht zeigt „Archivierte Fassungen“ (Datum, Format, Quelle, Download).

Angebote und Aufträge bleiben unverändert (Hinweisfenster bleibt; abgerechnete Aufträge sind serverseitig schon gesperrt, `backend/routes/jobs.js:333`). Angebote werden trotzdem archiviert.

## 3. Storno

`POST /api/invoices/:id/cancel` `{ reason: string (Pflicht, max. 500), releaseSources: boolean = true }`

Voraussetzung: Rechnung ist nicht `draft`, nicht `cancelled` und keine Stornorechnung. Sonst 409.

In einer Transaktion:
1. Neue Rechnung mit **eigenem Nummernkreis `ST-YYYY-NNN`**: dieselbe Logik wie bei `RE` (Jahr aus dem Rechnungsdatum, dreistellig, fortlaufend je Jahr). `generateInvoiceNumber` bekommt dafür einen Präfix-Parameter. Startnummer 1. Die Tabelle `yearly_invoice_start_numbers` gilt weiter nur für `RE`. Rechnungsdatum heute, Fälligkeit = Rechnungsdatum.
2. Positionen 1:1 kopiert, **Mengen und Rabattbeträge negiert**. Summen (`subtotal`, `tax_amount`, `total`, `global_discount_amount`) werden als **exakt negierte Werte des Originals** übernommen, nicht neu berechnet (keine Rundungsdifferenz).
3. Neue Spalten (Migration 015): `invoices.invoice_type` (`invoice` \| `cancellation`, Default `invoice`), `invoices.cancels_invoice_id` (FK auf das Original), `invoices.cancellation_reason`.
4. Original und Stornorechnung bekommen Status **`cancelled`** (neuer `InvoiceStatus`, Anzeige „Storniert“ bzw. „Stornorechnung“).
5. Kontingent: Die Stornorechnung zählt **nicht** (`quota_counted_at` wird gesetzt, ohne zu zählen). Storno muss auch im Free-Tarif mit ausgeschöpftem Kontingent gehen.
6. `releaseSources`: Aufträge mit `invoice_id = Original` → `invoice_id = NULL`, Status `completed`; Angebote mit `converted_to_invoice_id = Original` → NULL, Status `accepted`. So kann neu abgerechnet werden.
7. Audit `invoice.cancelled` (Original-ID, Storno-ID, Grund).

„Stornieren und neu erstellen“ = Storno, danach legt das Frontend einen **neuen Entwurf** als Kopie des Originals an (neue Nummer erst bei Anlage, wie bisher) und öffnet ihn im Editor. Quellen werden dabei nicht freigegeben, sondern auf den neuen Entwurf umgehängt.

Ausgabe der Stornorechnung:
- PDF: Titel „Stornorechnung“, Zeile „Storno zur Rechnung RE-… vom …“, Grund, negative Beträge.
- ZUGFeRD/XRechnung (Stand Nov. 2026, siehe Begründung unten):
  - BT-3 = **384** (Corrected invoice).
  - BG-3 Vorgängerrechnung mit Nummer (BT-25) **und** Datum (BT-26). CII: `ram:InvoiceReferencedDocument` mit `IssuerAssignedID` und `FormattedIssueDateTime`; UBL: `cac:BillingReference/cac:InvoiceDocumentReference`.
  - **Mengen negativ** (BT-129), **Einzelpreise positiv** (BT-146/148 dürfen nicht negativ sein). Daraus ergeben sich negative Positionsbeträge (BT-131), Steuerbeträge und Gesamtsumme.
  - Steuergruppen (BG-23) mit negativen Basis- und Steuerbeträgen, gleiche Kategorie und gleicher Satz wie das Original.
  - Prüfung mit dem KoSIT-Validator (XRechnung-Konfiguration, im Docker-Container) gehört zur Abnahme. Fehlermeldungen wie BR-CO-10/BR-S-08 deuten auf Rundungsdifferenzen hin; Summen deshalb aus den negierten Originalwerten, nicht neu berechnet.

  Begründung: Die KoSIT ordnet 381 der kaufmännischen Gutschrift zu. Eine vollständige Stornierung ist eine Korrektur, also 384 mit negativen Mengen und abgeleiteten Beträgen und positiven Einzelpreisen ([KoSIT, validator-configuration-xrechnung #58](https://github.com/itplr-kosit/validator-configuration-xrechnung/issues/58), Antworten von 2022 und Jan. 2025). Für 384 verlangen die deutschen Regeln den Bezug auf die Vorgängerrechnung ([Peppol DE-R-026](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/DE-R-026/)). Die Revision EN 16931-1:2026 soll negative Gesamtsummen bei 381 ausschließen. Das spricht zusätzlich gegen „381 mit Minus“; die nationale Umsetzung in XRechnung/ZUGFeRD steht noch aus. Anbieter-Ratgeber widersprechen sich teilweise (381 mit positiven Beträgen), die KoSIT-Linie ist aber die einzige offizielle Aussage.
- Versand/Download wie eine normale Rechnung, wird archiviert. Generatoren erlauben `cancelled` (nur `draft` ist gesperrt).

Folgewirkungen:
- Mahnwesen: `cancelled` ist automatisch ausgeschlossen (`reminders.js` filtert auf `sent/overdue/reminded_*`). Frontend-Überfälligkeitslogik (`documentFlow.ts`, Dashboard) muss `cancelled` ausnehmen.
- Reporting/Rechnungsjournal: Original und Storno erscheinen beide; offene/überfällige Summen schließen `cancelled` aus; Umsatz rechnet beide mit (netto 0). Neuer Status in Statusverteilung und PDF-Journal (`statusMap`).
- `discountUtils.ts` / `documentTotals.js`: werden für Storno nicht genutzt (Summen kopiert). Anzeige im Editor ist gesperrt, also keine Neuberechnung.
- Bereits bezahlte Rechnung: Storno erlaubt, Hinweis im Dialog „Erstattung an den Kunden erfolgt außerhalb von OpenBills“.

## 4. Archiv-Export

Einstellungen → Daten → „Archiv exportieren“ (Admin, **alle Tarife inkl. Free**), Zeitraum optional. Plan-Matrix in der Spec Plan-Tiers ergänzen: „Archiv-Export ✓“ in allen Spalten.

Vor dem Export zeigt der Dialog, wie viele freigegebene Rechnungen/Angebote **keine** Archivfassung haben (Altbelege vor diesem Update). Button „Fehlende Fassungen erzeugen“: Das Frontend erzeugt PDF (und bei Rechnungen ZUGFeRD) mit den vorhandenen Generatoren und lädt sie mit `source: 'regenerated'` hoch. Da Rechnungen gesperrt sind, entspricht das dem heutigen Stand; im Export steht dennoch „nachträglich erzeugt“.

ZIP-Aufbau (unverschlüsselt, da für Menschen gedacht; Download nur für Admins):

```
openbills-archiv_<firma>_<datum>.zip
├── LIESMICH.txt            Aufbau, Hinweis auf Aufbewahrungspflicht und „nachträglich erzeugt“
├── index.csv               Typ;Nummer;Datum;Kunde;Netto;USt;Brutto;Status;Format;Quelle;Archiviert am;SHA-256;Datei
├── rechnungen/RE-2026-001/RE-2026-001.pdf, …_xrechnung.xml
├── angebote/AN-…/
├── mahnungen/RE-2026-001_mahnung-1.pdf
├── anhaenge/<belegnummer>/<dateiname>
├── kunden.csv
└── rechnungsjournal.csv    alle Rechnungen inkl. Entwürfe und Storno mit Bezug
```

CSV: UTF-8 mit BOM, Semikolon, deutsches Zahlenformat (Excel-tauglich). Alle Archivfassungen werden exportiert, nicht nur die neueste.

Betreiber-Weg vor dem Löschen: `manage-instances.sh archive-export <name>` ruft dieselbe Exportfunktion im Backend-Container auf (Skript `backend/scripts/archiveExport.js`) und legt das ZIP unter `backups/` ab. `remove` bietet den Export vor der Rückfrage an. Fehlende Fassungen kann das Skript nicht erzeugen (Generatoren laufen im Browser); es meldet ihre Anzahl. Darum vor dem Löschen den Kunden zuerst den Export in der App ausführen lassen.

## 5. Tests

- Backend (DB-Tests wie `backupRestore.test.js`): Sperre (Feldänderung 409, gleicher Wert ok, Statuswechsel ok, Rückweg auf `draft` mit/ohne Archiv, Löschen), Storno (Summen negiert, Nummer fortlaufend, Status, Quellen freigegeben, kein Kontingent, doppeltes Storno 409), Archiv (Deduplizierung, append-only, Entwurf abgelehnt), Backup-Restore mit Archiv, `backupTables`-Vollständigkeit.
- Frontend: XRechnung/ZUGFeRD für Stornorechnung (TypeCode, Referenz, Vorzeichen) als Snapshot; Ausgabe-Helper ruft Archiv vor Download auf.
- Manuell: KoSIT-Validator für Stornorechnung (beide Formate).

## Entscheidungen

1. Archiv nur optional im Backup (Default aus), Warnung über 500 MB → Archiv separat exportieren.
2. Stornorechnungen bekommen einen eigenen Kreis `ST-YYYY-NNN` mit derselben Logik wie `RE`.
3. E-Rechnung: 384 + BG-3, negative Mengen, positive Einzelpreise; Abnahme mit dem KoSIT-Validator.
