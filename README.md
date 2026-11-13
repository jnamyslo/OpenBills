<div align="center">
  <img src="backend/assets/Belego.png" alt="Belego Logo" width="400">
</div>

# Moderne Rechnungssoftware für KMU, Handwerk & Dienstleister

> Leistungsstarke, eRechnung-konforme Rechnungs- und Angebotssoftware mit Auftragsverwaltung, Zeiterfassung, Mahnwesen, E‑Mail‑Versand und Backup – entwickelt für den deutschen Markt.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Open Source](https://img.shields.io/badge/Open%20Source-100%25-success.svg)](https://github.com/jnamyslo/Belego)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://docker.com)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18%2B-blue.svg)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-blue.svg)](https://postgresql.org)
[![Responsive](https://img.shields.io/badge/Design-Responsive-orange.svg)](#-responsive-design)

**🚀 Vollständig containerisiert • 📱 Mobile‑First • 🔒 GoBD/DSGVO‑geeignet • 🌍 Multi‑Instanz**

---

## 🔎 Warum Belego?

Belego ist eine praxisnahe, in Deutschland entwickelte Open‑Source‑Rechnungssoftware. Sie deckt den kompletten Prozess von Angebot über Auftrag/Zeiterfassung bis zur Rechnung inkl. eRechnung (ZUGFeRD/XRechnung), Versand per E‑Mail, Mahnwesen und Backups ab. Ideal für KMU, Startups, Handwerksbetriebe und Freelancer.

Suchbegriffe (SEO): Rechnungssoftware, Rechnungsprogramm, eRechnung, ZUGFeRD, XRechnung, GoBD, Mahnwesen, Angebote, Auftragsverwaltung, Zeiterfassung, Handwerk, KMU, PostgreSQL, Docker.

---

## 🌟 Funktionsumfang

### 📄 Rechnungen
- **Erstellung und Bearbeitung** mit anpassbaren Positionen, Rabatten (Position & global)
- **Automatische Rechnungsnummerierung** (jährlich mit Startwerten je Jahr)
- **Anhänge** (PDF/Dokumente) pro Rechnung
- **E‑Mail‑Versand** direkt aus der App (SMTP, mehrere Empfänger)
- **Status & Fälligkeit**: Entwurf, versendet, bezahlt, überfällig, inkl. Mahnstufen
- **Export-Formate**: Standard PDF, **ZUGFeRD 2.1** (PDF/A‑3 + XML), **XRechnung 3.0** (XML)

### 💼 Angebote (optional)
- Angebote mit Gültigkeitsdatum, Status‑Workflow (Entwurf → Versendet → Angenommen/Abgelehnt/Abgelaufen)
- PDF‑Export, E‑Mail‑Versand, Anhänge
- Ein‑Klick‑Konvertierung von Angebot → Rechnung

### 👥 Kundenverwaltung (CRM)
- Vollständige Kundendaten inkl. **mehrerer E‑Mail‑Adressen**
- Kundenspezifische **Stundensätze** und **Materialien**

### 🛠️ Aufträge & Zeiterfassung (optional)
- Jobbasierter Workflow mit Status (Entwurf, in Bearbeitung, abgeschlossen, abgerechnet)
- Mehrere Zeiteinträge pro Job, Materialien, Notizen, Anhänge
- **Digitale Unterschrift** für Abnahmen (Signatur-Pad)

### ⏰ Mahnwesen (Payment Reminders) (optional)
- Mahnstufen 1–3 inkl. Gebühren, Texte und Historie
- Versand per E‑Mail (PDF‑Mahnungen), Tracking von letzter Mahnung und max. Stufe

### 📊 Reporting (optional)
- Journal/Export mit Zeitraum‑ und Kundenfilter
- Summen (Netto, Steuer, Brutto), Statusverteilung, Kunden‑Toplisten

### 🏢 Unternehmensanpassung
- Firmenprofil mit **Logo, Icon, Farben, zwei‑zeiligem Kopfbereich**
- IBAN/BIC & getrennte **Zahlungsinformationen** (Kontoinhaber, Bank, Zahlungsbedingungen, -methoden)
- Kleinunternehmer‑Option (§19 UStG)

### 🔁 Multi‑Instanz & Backups
- Beliebig viele Mandanten auf einem Server (getrennte Datenbanken/Ports)
- **JSON‑Backups** und **Vollbackups (ZIP)** inkl. Dateien und Metadaten

---

## 📸 Screenshots & Einblicke

Erleben Sie Belego in Aktion – hier sind einige Einblicke in die Benutzeroberfläche:

### Dashboard & Übersicht
<div align="center">
  <img src="demo/Dashboard.png" alt="Belego Dashboard" width="800">
  <p><em>Übersichtliches Dashboard mit allen wichtigen Kennzahlen, überfälligen Rechnungen und Schnellzugriffen</em></p>
</div>

### Rechnungsverwaltung
<div align="center">
  <img src="demo/Rechnungseditor.png" alt="Rechnungseditor" width="800">
  <p><em>Intuitiver Rechnungseditor mit Drag & Drop, Live-Vorschau und Rabatten auf Positions- und Gesamtebene</em></p>
</div>

<div align="center">
  <img src="demo/Rechnungsversand.png" alt="Rechnungsversand per E-Mail" width="800">
  <p><em>E-Mail-Versand mit ZUGFeRD/XRechnung-Unterstützung, mehreren Empfängern und individuellen Anhängen</em></p>
</div>

<div align="center">
  <img src="demo/Rechnungsdownload.png" alt="Rechnungsdownload" width="800">
  <p><em>Multi-Format-Export: Standard-PDF, ZUGFeRD 2.1 und XRechnung 3.0 – alles mit einem Klick</em></p>
</div>

### Kundenverwaltung & CRM
<div align="center">
  <img src="demo/Kundenanlage.png" alt="Kundenverwaltung" width="800">
  <p><em>Vollständige Kundenverwaltung mit mehreren E-Mail-Adressen, kundenspezifischen Stundensätzen und Materialien</em></p>
</div>

### Auftrags- & Zeiterfassung
<div align="center">
  <img src="demo/Auftragsmanagement.png" alt="Auftragsverwaltung" width="800">
  <p><em>Professionelles Auftragsmanagement mit Zeiterfassung, Materialien, Status-Tracking und digitaler Unterschrift</em></p>
</div>

### Mahnwesen
<div align="center">
  <img src="demo/Mahnwesen.png" alt="Mahnwesen" width="800">
  <p><em>Automatisiertes Mahnwesen mit 3 Mahnstufen, konfigurierbaren Gebühren und E-Mail-Versand</em></p>
</div>

### Reporting & Auswertungen
<div align="center">
  <img src="demo/Reportingh.png" alt="Reporting" width="800">
  <p><em>Umfassende Auswertungen mit Zeitraum-Filtern, Umsatzstatistiken und Kunden-Toplisten</em></p>
</div>

---

## 🇩🇪 eRechnung & Compliance

### Unterstützte Standards
- EN 16931, **ZUGFeRD 2.1**, **XRechnung 3.0**, PEPPOL BIS Billing 3.0, UBL 2.1, UN/CEFACT CII

### Validierung & Qualität
- Automatische Struktur‑ und Regelprüfungen, KOSIT‑konforme Generierung, PDF/A‑3 für Langzeitarchivierung

### Recht & Datenschutz
- GoBD‑geeignete Arbeitsweise, DSGVO‑freundlich (Self‑Hosting, lokale Daten), AO‑konforme Archivierung möglich

---

## 🔧 Systemanforderungen

### Minimal
- Docker 20.10+ und Docker Compose 2.0+
- RAM: 2 GB (4 GB empfohlen)
- Speicher: 5 GB (mehr für Backups)
- CPU: 2 Kerne (4+ empfohlen)
- OS: Linux, macOS, Windows (WSL2)

### Produktion (Empfehlung)
- RAM 8 GB+, Speicher 50 GB+, stabile Internetverbindung für E‑Mail

---

## 🚀 Installation & Quickstart

### Multi‑Instanz Setup

```bash
git clone https://github.com/jnamyslo/Belego.git
cd Belego
```

Interaktiv (empfohlen):
```bash
./deploy-instance.sh
```
Was passiert:
- Instanzname, Port‑Erkennung, Tarif‑Auswahl, sichere Passwörter, Konfigurationstest

Schnell‑Deployment (ohne E‑Mail‑Setup):
```bash
./deploy-instance.sh --legacy client1 5432 3001 8080 [tarif]
#                           ^name   ^db   ^api ^web  ^optional, siehe „Tarife“
```

# Zugriff
# Frontend: http://localhost:8080

Beispiel‑Portschema:

| Instanz | DB | API | Web | URL |
|---|---:|---:|---:|---|
| client1 | 5432 | 3001 | 8080 | http://localhost:8080 |
| client2 | 5433 | 3002 | 8081 | http://localhost:8081 |
| client3 | 5434 | 3003 | 8082 | http://localhost:8082 |

### Instanzen verwalten

```bash
./manage-instances.sh --help
./manage-instances.sh list
./manage-instances.sh start client1
./manage-instances.sh stop client1
./manage-instances.sh restart client1
./manage-instances.sh logs client1 [backend]
./manage-instances.sh backup client1
./manage-instances.sh config client1
./manage-instances.sh remove client1   # ⚠️ löscht Daten
```

`list` zeigt pro Instanz Status, Tarif und Ports.

---

## 💳 Tarife (Managed SaaS)

Self‑Hosted‑Instanzen haben **immer den vollen Funktionsumfang ohne Limits**. Tarife sind nur für betriebene (Managed‑SaaS‑)Instanzen gedacht und werden pro Instanz in `.env.backend.<name>` gesetzt:

```bash
BELEGO_PLAN=starter                          # free | starter | professional | enterprise; leer = self-hosted
BELEGO_UPGRADE_CONTACT=vertrieb@example.com  # E-Mail, Telefon oder URL im Upgrade-Hinweis
```

`deploy-instance.sh` fragt beides ab. Nachträglich ändern: `./manage-instances.sh config <name>`, danach `./manage-instances.sh restart <name>`. Ein unbekannter Wert in `BELEGO_PLAN` verhindert den Start des Backends (kein stilles „unbegrenzt“ bei Tippfehlern).

| | Free | Starter | Professional | Enterprise |
|---|---:|---:|---:|---:|
| Rechnungen / Monat | 5 | 25 | 100 | ∞ |
| Angebote / Monat | 5 | 25 | 100 | ∞ |
| Kunden (gesamt) | 10 | 50 | 250 | ∞ |
| PDF, XRechnung, ZUGFeRD, Backup | ✓ | ✓ | ✓ | ✓ |
| E‑Mail‑Versand, Mahnwesen | – | ✓ | ✓ | ✓ |
| Aufträge & Zeiterfassung | – | – | ✓ | ✓ |
| Kundenspez. Stundensätze, Materialvorlagen | – | – | ✓ | ✓ |
| Reporting | Basis | Basis | voll | voll |

**Zählregeln**
- Eine Rechnung bzw. ein Angebot zählt **einmal**, sobald es den Entwurfsstatus verlässt (z. B. beim Versand). Entwürfe sind unbegrenzt.
- Löschen gibt kein Kontingent zurück. Abrechnungsmonat ist der Kalendermonat der Freigabe (deutsche Zeit).
- Am Limit wird die Freigabe abgelehnt; die App zeigt einen Upgrade‑Hinweis mit dem hinterlegten Kontakt.
- Nach einem Downgrade bleiben bestehende Daten erhalten; gesperrt werden nur neue Freigaben und nicht enthaltene Funktionen.

**Entwürfe** tragen in Vorschau und Download (in allen Instanzen, auch self‑hosted) das Wasserzeichen „ENTWURF“ und lassen sich nicht als XRechnung oder mit eingebettetem ZUGFeRD exportieren. Beim E‑Mail‑Versand oder Download mit „als versendet markieren“ wird der Entwurf vorher freigegeben, der Empfänger erhält ein fertiges Dokument.

Details: [`docs/superpowers/specs/2026-11-13-plan-tiers.md`](docs/superpowers/specs/2026-11-13-plan-tiers.md)

---

## ✉️ E‑Mail & SMTP

- SMTP‑Einstellungen in der App pflegbar (DB‑gestützt), Test‑Verbindung, Test‑E‑Mail
- Versand von Rechnungen/Angeboten/Mahnungen inkl. Anhängen, mehrere Empfänger, Vorlagentexte
- E‑Mail‑Historie mit Status, Fehlern, Statistik und Suche

Beispiele (typische Provider):

| Provider | Host | Port | Verschlüsselung |
|---|---|---:|---|
| Gmail | smtp.gmail.com | 587 | STARTTLS |
| Outlook | smtp-mail.outlook.com | 587 | STARTTLS |
| T‑Online | securesmtp.t-online.de | 465 | SSL/TLS |

---

## 💾 Backups & Restore

- JSON‑Backups aller Tabellen
- Voll‑Backups als ZIP (inkl. Datenbank‑Dump im JSON‑Format + Metadaten)
- Download/Upload/Restore direkt in der App (mit Kompatibilitäts‑Fixes)

---

## 📱 Responsive Design

- Mobile‑First, Touch‑optimiert, Safe‑Area‑Support
- Adaptive Listen/Tabellen, Kartenansichten, große Touch‑Targets

---

## 🏗️ Architektur

### Frontend
- React 18 + TypeScript, Vite, Tailwind CSS, Context API

### Backend
- Node.js (Express), PostgreSQL
- Datei‑Uploads (Multer), strukturierte Logs

### Deployment
- Docker & Docker Compose, optional Nginx
- Healthchecks, automatisierte Backups

---

## 📊 Roadmap (Auszug)

Bereits umgesetzt:
- eRechnung (ZUGFeRD/XRechnung), Multi‑Format‑Export
- Angebote (optional), Mahnwesen, E‑Mail‑Management
- Kunden‑spezifische Sätze/Materialien, digitale Unterschriften
- Reporting/Journal, Multi‑Instanz, Responsive UI, Backups

Geplant:
- Automatische Backup‑Zyklen, Massenversand, Integrations‑API, Vorlagen‑Editor, weitere Sprachen

---

## 🤝 Beiträge willkommen

1. Repository forken, Feature‑Branch anlegen
2. Änderungen committen, Push, Pull‑Request öffnen

Leitlinien: saubere Commits, ESLint‑Regeln, Doku aktualisieren, Features testen.

Besonders willkommen: Übersetzungen, UI/UX, Reporting, Performance, Doku.

---

## ⚖️ Lizenzierung

Belego ist **100% Open Source** und lizenziert unter der **GNU Affero General Public License v3.0 (AGPL‑3.0)**.

### Was bedeutet das?

✅ **Du kannst:**
- Belego kostenlos für persönliche oder geschäftliche Zwecke nutzen
- Den Code ändern und an deine Bedürfnisse anpassen
- Die Software weiterverteilen (auch modifizierte Versionen)
- Zum Projekt beitragen

✅ **Du musst:**
- Den Quellcode offenhalten und verfügbar machen
- Deine Änderungen ebenfalls unter AGPL v3 lizenzieren
- Copyright‑ und Lizenzhinweise beibehalten

### Warum AGPL v3?

Die AGPL v3 schützt die Freiheit der Software auch bei Netzwerk‑Nutzung. Sie sorgt dafür, dass:
- Belego für immer frei und Open Source bleibt
- Verbesserungen der gesamten Community zugutekommen
- Die Community vor proprietären Forks geschützt ist

### Unterstützung & Kommerzieller Support

Während die Software frei ist, kannst du professionellen Support erhalten:
- 💼 Managed Hosting Services
- 🎓 Schulungen und Onboarding
- 🔧 Individuelle Anpassungen und Features
- 🚀 Priority Support

Kontakt: info@namyslo-solutions.de

Volltexte siehe [`LICENSE`](LICENSE) oder [gnu.org/licenses/agpl‑3.0.html](https://www.gnu.org/licenses/agpl-3.0.html).

---

## 🆘 Support & Troubleshooting

Ports belegt?
```bash
lsof -i :3001
netstat -tuln | grep :3001
```

E‑Mail funktioniert nicht?
```bash
./manage-instances.sh config your-instance
./manage-instances.sh restart your-instance
```

Container startet nicht?
```bash
./manage-instances.sh logs your-instance
docker ps -a --filter "name=belego-"
```

Community & Kontakt:
- Wiki: [GitHub Wiki](https://github.com/jnamyslo/Belego/wiki)
- Issues: [Bug Reports & Feature Requests](https://github.com/jnamyslo/Belego/issues)
- Discussions: [Community Support](https://github.com/jnamyslo/Belego/discussions)
- Commercial Support: info@namyslo-solutions.de

Projekt unterstützen:
- ⭐ Stern auf GitHub, 🍴 Fork, 📢 Weiterempfehlung

---

<div align="center">

### 🚀 Entwickelt mit ❤️ in Deutschland

**[⭐ Stern geben](https://github.com/jnamyslo/Belego)** • **[🍴 Fork erstellen](https://github.com/jnamyslo/Belego/fork)** • **[📖 Doku](https://github.com/jnamyslo/Belego/wiki)**

—

*Made in Germany 🇩🇪 • 100% Open Source • AGPL‑3.0*

</div>