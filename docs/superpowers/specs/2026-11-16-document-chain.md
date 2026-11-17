# Belegkette Angebot → Auftrag → Rechnung

## Ziel
Aus einem angenommenen Angebot entsteht (bei aktivem Auftragsmodul) ein Auftrag, daraus die Rechnung.
Die Kette ist in allen drei Editoren sichtbar. Direkte Abrechnung (Angebot → Rechnung) bleibt möglich.

## Module und Tarif
| Aktiv | Kette |
|---|---|
| nur Rechnungen | – |
| Angebote | Angebot → Rechnung |
| Aufträge (Tarif-Feature `jobs`) | Auftrag → Rechnung |
| beides | Angebot → Auftrag → Rechnung (oder direkt abrechnen) |

`getFlowSteps` (`src/utils/documentFlow.ts`) leitet die Schritte aus `quotesEnabled`, `jobTrackingEnabled`
und der Lizenz ab. Ein eingeschaltetes, aber nicht lizenziertes Auftragsmodul bleibt als gesperrter Schritt
sichtbar. Vorschau der Kette: Einstellungen → Module.

## Datenmodell (Migrationen 011, 012)
- `job_entries.quote_id` – Angebot, aus dem der Auftrag entstand.
- `job_entries.invoice_id` – Rechnung, auf der der Auftrag abgerechnet wurde. Mehrere Aufträge je Rechnung möglich.
- `job_entries.global_discount_type/value` – Gesamtrabatt (nur Art und Wert; der Betrag ergibt sich auf der Rechnung).
- `quotes.converted_to_invoice_id` bleibt; die Kette ergibt sich aus den Verweisen, es gibt keinen Status „ordered“.

## Abläufe
- `POST /quotes/:id/convert-to-job` (Feature `jobs`): nur angenommene, noch nicht abgerechnete Angebote ohne Auftrag.
  Positionen werden 1:1 als Auftragsmaterial übernommen, der Gesamtrabatt mit.
- Auftrag abrechnen (`JobInvoiceGenerator`): setzt `invoice_id` am Auftrag; das Backend setzt das Angebot auf
  „abgerechnet“ (`converted_to_invoice_id`).
- Direkte Abrechnung ist gesperrt, sobald ein Auftrag zum Angebot existiert (sonst doppelte Abrechnung).
- Direkte Abrechnung rechnet die Summen mit den heutigen Einstellungen neu (`backend/utils/documentTotals.js`):
  Kleinunternehmer → Positionen 0 %, keine Steuer; Regelbesteuerung → Steuer aus den Positionen.

## Summenregeln
- Alle Summen laufen über `calculateInvoiceWithDiscounts` (Frontend) bzw. dessen Spiegel `calculateTotals` (Backend).
  `documentTotalsParity.test.ts` prüft beide gegeneinander – Änderungen an der Rechenlogik immer in beiden machen.
- Der Gesamtrabatt wirkt nach Positionsrabatten und verteilt sich proportional auf die Steuersätze.
- Eine Rechnung kennt nur einen Gesamtrabatt. Sammelabrechnung fasst deshalb nur Aufträge ohne Rabatt bzw. mit
  gleichem Prozentsatz zusammen (`groupJobsByGlobalDiscount`); Festbeträge und abweichende Prozentsätze werden
  getrennt abgerechnet. Sonst würde die Steuer je Satz von der Summe der Einzelrechnungen abweichen.

## Darstellung
`DocumentFlow` zeigt die Schritte als Stepper (mobil untereinander), mehrere Belege eines Schritts gestapelt
(ab vier „+ n weitere“). `buildChain` liefert je Beleg die Herkunft (nach oben) und Folgebelege (nach unten);
Geschwister einer Sammelrechnung gehören nicht dazu. Belege sind anklickbar (`documentHash`); der aktuelle nicht.
Beim Öffnen wird der Editor verlassen, davor fragt eine Bestätigung nach.

## Bekannte Grenzen
- Bestehende Aufträge haben keine Verknüpfung zu Angeboten/Rechnungen; ihre Kette bleibt leer.
- Rechnungen/Aufträge werden über die Listensuche geöffnet (keine eigene Editor-Route).
