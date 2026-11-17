# Angebot per Mail-Link annehmen/ablehnen

Kunden können ein per Mail versendetes Angebot ohne Login über einen persönlichen Link annehmen oder ablehnen.

## Ablauf

1. `POST /api/quotes/:id/send-email` erzeugt für Angebote im Status `sent` ein Token (eins pro Versand, gilt für alle Empfänger der Mail) und baut zwei Buttons in die Mail ein: „Angebot annehmen“ → `#angebot/<token>/annehmen`, „Angebot ablehnen“ → `#angebot/<token>/ablehnen`. Entwürfe (Wasserzeichen) und die Demo bekommen keine Buttons. Scheitert der Versand, wird das Token wieder gelöscht.
2. Der Link öffnet eine öffentliche Seite (ohne Login) mit Angebotsübersicht. **Der Aufruf ändert nichts** – Mail-Scanner (Safe Links o. ä.) rufen Links vorab auf. Erst der Bestätigungs-Button sendet die Entscheidung.
3. Pflicht: Name. Bei Annahme zusätzlich AGB-Checkbox, sofern in den Firmendaten ein AGB-Link (`terms_url`) hinterlegt ist. Kommentar optional. Ablehnen: nur Name + optionaler Grund.
4. Ergebnis: Angebotsstatus `accepted`/`rejected`, Eintrag im Audit-Log (`quote.customer_accepted|rejected`), Benachrichtigung an die Firmen-E-Mail (Systemmail-Route). Keine automatische Umwandlung in Auftrag/Rechnung.

## Gültigkeit eines Links

`GET`/`POST /api/quote-response/:token` werten in dieser Reihenfolge aus:

| Status     | Bedingung |
|------------|-----------|
| `invalid`  | Token unbekannt |
| `answered` | Über diesen Link wurde schon entschieden (liefert `decision`) |
| `closed`   | Angebot nicht mehr im Status `sent` (z. B. intern angenommen, abgelaufen, abgerechnet) |
| `expired`  | Nach Ende des Tages `valid_until` (Europe/Berlin) |
| `changed`  | Angebot wurde nach dem Versand inhaltlich geändert (Fingerabdruck aus Kunde, Gültigkeit, Positionen, Rabatten, Summen) |
| `valid`    | sonst |

`POST` antwortet bei nicht gültigem Link mit 409 und `{ status }`. Entscheidung, Name, Kommentar, akzeptierte AGB-URL, IP, User-Agent und Zeitpunkt werden in `quote_responses` gespeichert; Angebot und Token werden in einer Transaktion (`FOR UPDATE`) geändert.

## Sicherheit

- Token: 32 Byte Zufall, gespeichert nur als SHA-256-Hash; steht im Hash-Fragment (nicht in Server-/Proxy-Logs).
- Routen in `PUBLIC_API_PATHS`; POST unterliegt `originCheck`, Rate-Limit 20 / 15 min je IP, Body max. 100 kB.
- `terms_url` nur `http(s)://` (Backend-Validierung, Frontend rendert nur solche Links).
- In der Demo sind die öffentlichen Routen gesperrt (403 `DEMO_DISABLED`).

## Daten

Migration `014_quote_responses`: Tabelle `quote_responses` (im App-Backup, da Geschäftsnachweis) und Spalte `company.terms_url`.
`findQuoteById`/`findAllQuotes` liefern die letzte Kundenantwort als `customerResponse { decision, name, comment, respondedAt }`; die Angebotsliste zeigt sie unter dem Status.
