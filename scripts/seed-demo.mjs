// Befüllt eine frische OpenBills-Instanz über die REST-API mit fiktiven Demo-Daten
// (für Screenshots/Demos). Verschickt keine E-Mails.
//
// Aufruf (in Docker, kein npm auf dem Host):
//   docker run --rm --network host -v "$PWD/scripts":/s:ro node:24-alpine \
//     node /s/seed-demo.mjs http://localhost:<api-port>/api

const API = (process.argv[2] || 'http://localhost:3001/api').replace(/\/$/, '');

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const item = (description, quantity, unitPrice, order, taxRate = 19) =>
  ({ description, quantity, unitPrice, taxRate, total: quantity * unitPrice, order });

const existing = await call('GET', '/customers');
if (existing.length > 0) {
  console.error(`Abbruch: Instanz enthält bereits ${existing.length} Kunden. Nur für frische Instanzen gedacht.`);
  process.exit(1);
}

await call('PUT', '/company', {
  name: 'Muster Handwerk GmbH',
  address: 'Werkstattweg 7',
  city: 'Frankfurt am Main',
  postalCode: '60311',
  country: 'Deutschland',
  phone: '+49 69 1234567',
  email: 'info@muster-handwerk.example',
  website: 'www.muster-handwerk.example',
});

const customerData = [
  ['Bäckerei Sonnenschein', 'Brotgasse 3', '60313', 'Frankfurt am Main'],
  ['Architekturbüro Lindner & Partner', 'Mainzer Landstraße 120', '60327', 'Frankfurt am Main'],
  ['Hausverwaltung Weber KG', 'Schillerstraße 44', '63065', 'Offenbach am Main'],
  ['Café Morgenrot', 'Bergerstraße 210', '60385', 'Frankfurt am Main'],
  ['Zahnarztpraxis Dr. Hoffmann', 'Kurhausplatz 1', '61348', 'Bad Homburg'],
  ['Autohaus Becker GmbH', 'Industriestraße 15', '65760', 'Eschborn'],
];
const customers = [];
for (const [name, address, postalCode, city] of customerData) {
  const slug = name.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  customers.push(await call('POST', '/customers', {
    name, address, postalCode, city, country: 'Deutschland', email: `kontakt@${slug}.example`,
  }));
}
const c = (i) => customers[i].id;

// [Kunde, Ausstellung (Tage relativ zu heute), Zahlungsziel (Tage), Status, Positionen]
const invoiceData = [
  [0, -165, 14, 'paid', [item('Wartung Lüftungsanlage Backstube', 1, 480, 1), item('Filtersatz', 2, 65, 2)]],
  [1, -140, 14, 'paid', [item('Elektroinstallation Büroetage', 32, 68, 1), item('Kabel & Kleinmaterial', 1, 420, 2)]],
  [2, -118, 30, 'paid', [item('Treppenhausbeleuchtung LED-Umrüstung', 1, 2350, 1)]],
  [3, -95, 14, 'paid', [item('Montage Thekenbeleuchtung', 6, 68, 1), item('LED-Profile', 4, 89, 2)]],
  [4, -70, 14, 'overdue', [item('Prüfung ortsveränderlicher Geräte (DGUV V3)', 48, 9.5, 1)]],
  [5, -58, 14, 'reminded_1x', [item('Ladesäulen-Installation 22 kW', 2, 1450, 1), item('Anfahrt', 1, 45, 2)]],
  [0, -40, 14, 'sent', [item('Reparatur Teigknetmaschine', 3, 68, 1), item('Ersatzteil Antriebsriemen', 1, 115, 2)]],
  [2, -25, 30, 'sent', [item('Wohnung 3 OG: Elektrik Sanierung', 18, 68, 1), item('Unterverteilung', 1, 640, 2)]],
  [1, -12, 14, 'sent', [item('Netzwerkverkabelung Cat7, 12 Dosen', 12, 95, 1)]],
  [3, -5, 14, 'draft', [item('Außenbeleuchtung Terrasse', 5, 68, 1), item('Wandleuchten IP65', 6, 74, 2)]],
  [4, -2, 14, 'draft', [item('Notbeleuchtung Wartung', 1, 290, 1)]],
  [5, -1, 14, 'draft', [item('Werkstattbeleuchtung Hallenstrahler', 10, 189, 1), item('Montage', 8, 68, 2)]],
];
for (const [ci, issue, term, status, items] of invoiceData) {
  // Wie im Frontend: anlegen, dann Status setzen (Freigabe zählt beim ersten Nicht-Entwurf-Status)
  const inv = await call('POST', '/invoices', {
    customerId: c(ci), issueDate: day(issue), dueDate: day(issue + term), items, status: 'draft',
  });
  if (status !== 'draft') await call('PUT', `/invoices/${inv.id}`, { status });
}

const quoteData = [
  [1, -20, 'accepted', [item('Smart-Home-Nachrüstung Besprechungsräume', 1, 3890, 1)]],
  [4, -9, 'sent', [item('Praxisumbau Elektro, Pauschale', 1, 7450, 1), item('Röntgenraum Sonderinstallation', 1, 1980, 2)]],
  [3, -3, 'draft', [item('Photovoltaik-Beratung inkl. Planung', 1, 450, 1)]],
];
for (const [ci, issue, status, items] of quoteData) {
  const q = await call('POST', '/quotes', {
    customerId: c(ci), issueDate: day(issue), validUntil: day(issue + 30), items, status: 'draft',
  });
  if (status !== 'draft') await call('PUT', `/quotes/${q.id}`, { status });
}

const jobData = [
  [2, 'Zählerschrank erneuern', 'Altbau Schillerstraße, Hauptverteilung tauschen', -6, 'completed', 'high', 6.5],
  [0, 'Backofen-Anschluss prüfen', 'Sicherung fliegt sporadisch, Fehlersuche', -1, 'in-progress', 'medium', 2],
  [5, 'Wallbox Kundenparkplatz', 'Zweite Ladesäule vorbereiten, Leerrohr verlegen', 4, 'draft', 'low', 0],
];
for (const [ci, title, description, date, status, priority, hours] of jobData) {
  await call('POST', '/jobs', {
    customerId: c(ci), customerName: customers[ci].name, title, description, date: day(date),
    status, priority, hoursWorked: hours, hourlyRate: 68,
    timeEntries: hours ? [{ description: title, hoursWorked: hours, hourlyRate: 68, taxRate: 19, total: hours * 68 }] : [],
    materials: [],
  });
}

console.log(`Fertig: ${customers.length} Kunden, ${invoiceData.length} Rechnungen, ${quoteData.length} Angebote, ${jobData.length} Aufträge.`);
