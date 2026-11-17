# Plan-Tiers für Managed SaaS

Stand: 2026-11-13

## Ziel

Managed-SaaS-Instanzen bekommen einen Plan (Free, Starter, Professional, Enterprise) mit Limits und Feature-Gates. Self-Hosted bleibt uneingeschränkt.

## Entscheidungen

- **Kein Lizenzkey.** Der Betreiber steuert jede Instanz selbst. Plan per Env-Var `OPENBILLS_PLAN` in `.env.backend.<name>`.
- `OPENBILLS_PLAN` fehlt → Plan `selfhosted` = alles unlimited, alle Features.
- Plan-Definitionen als Konstante im Code (`backend/utils/plan.js`), nicht in Env.
- Auth: lokale Anmeldung, siehe `docs/superpowers/specs/2026-11-13-auth.md` (ersetzt Authentik + NPM Forward-Auth). Plan gilt pro Instanz.

## Tier-Matrix

| | Free | Starter | Professional | Enterprise |
|---|---|---|---|---|
| Rechnungen/Monat | 5 | 25 | 100 | ∞ |
| Angebote/Monat (eigener Zähler) | 5 | 25 | 100 | ∞ |
| Kunden (gesamt) | 10 | 50 | 250 | ∞ |
| PDF, XRechnung, ZUGFeRD | ✓ | ✓ | ✓ | ✓ |
| E-Mail-Versand | ✗ | ✓ | ✓ | ✓ |
| Mahnwesen | ✗ | ✓ | ✓ | ✓ |
| Aufträge / Zeiterfassung | ✗ | ✗ | ✓ | ✓ |
| Kundenspez. Stundensätze, Materialvorlagen | ✗ | ✗ | ✓ | ✓ |
| Reporting | Basis | Basis | voll | voll |
| Backup-Export | ✓ | ✓ | ✓ | ✓ |

eRechnung und Backup werden bewusst nie eingeschränkt (E-Rechnungspflicht, GoBD/DSGVO).

## Zählregeln

- Rechnung/Angebot zählt **einmal**, beim ersten Status ≠ `draft`. Das gilt für `POST` mit Nicht-Entwurfsstatus und für `PUT`-Statuswechsel.
- Spalte `quota_counted_at` auf `invoices` und `quotes` verhindert doppeltes Zählen (z. B. sent → draft → sent).
- Tabelle `usage_counters (period 'YYYY-MM', kind, count)`. Löschen gibt kein Kontingent zurück.
- Periode = Kalendermonat des Freigabezeitpunkts (Serverzeit), nicht `issue_date`.
- Entwürfe sind unbegrenzt.
- Kundenlimit: Live-Count bei `POST /api/customers`.
- Limit erreicht → HTTP 402, deutsche Meldung, Frontend zeigt Upgrade-Hinweis mit Kontakt.
- Downgrade: bestehende Daten bleiben voll nutzbar, nur Neuanlagen und Freigaben werden blockiert.
- Mahnungen nur für freigegebene Rechnungen, zählen nicht extra.

## Entwürfe: Wasserzeichen „ENTWURF“

Gilt **immer**, auch self-hosted, unabhängig vom Plan.

| Kanal | Verhalten | Durchsetzung |
|---|---|---|
| Vorschau / Download PDF | jspdf zeichnet Wasserzeichen | Frontend |
| E-Mail-Versand | UI gibt Entwurf **vor** dem Versand frei (Status `sent`, zählt). Backend lädt Status per ID aus DB; ist er trotzdem `draft`, stempelt `pdf-lib` Wasserzeichen und entfernt eingebettetes XML | Backend (hart) |
| Download mit „als versendet markieren“ | UI gibt Entwurf vor dem Download frei → Dokument ohne Wasserzeichen | Frontend |
| XRechnung-XML, ZUGFeRD | Für Entwürfe gesperrt | Frontend + Backend-Versand |

Freigabe vor Ausgabe (`src/utils/releaseForOutput.ts`): Schlägt die Freigabe fehl (402), wird nichts ausgegeben. Schlägt die Ausgabe nach der Freigabe fehl, geht der Status zurück auf `draft`; das Kontingent bleibt verbraucht, ein erneuter Versuch zählt nicht noch einmal.

Bekanntes Restrisiko: Frontend-Wasserzeichen ist per DevTools umgehbar. Akzeptiert. Später optional: serverseitige PDF-Ausgabe.

## API

- `GET /api/plan` → `{ plan, features, limits, usage: { invoices, quotes, customers }, period, upgradeContact }`
- Middleware `requireFeature(name)` auf Feature-Routes → 403 mit `{ error, code: 'FEATURE_NOT_IN_PLAN' }`
- Limit-Fehler → 402 mit `{ error, code: 'PLAN_LIMIT_REACHED', kind, limit }`

## Konfiguration

`.env.backend.<name>` (Vorlage in `deploy-instance.sh`):

```bash
OPENBILLS_PLAN=              # free | starter | professional | enterprise; leer/fehlt = selfhosted
OPENBILLS_UPGRADE_CONTACT=   # E-Mail, Telefon oder URL im Upgrade-Hinweis
```

Unbekannter Wert in `OPENBILLS_PLAN` → Startfehler (kein stilles Fallback auf unlimited).

## Reporting

- **Basis** (Free, Starter): Umsatz laufender Monat und laufendes Jahr.
- **Voll** (Professional, Enterprise): zusätzlich Kunden-Auswertungen, freie Zeiträume, Rechnungsjournal-PDF/Export.

## Nicht im Scope

- ~~Eigene SMTP / Absenderdomain als Feature-Gate: gestrichen.~~ Überholt durch `2026-11-14-platform-mail-design.md` (Plattform-Mailversand, eigener Mailserver ab Professional, eigener Systemabsender ab Enterprise).
- Lizenzkeys, Billing, Self-Service-Upgrade.
