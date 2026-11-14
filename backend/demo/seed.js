/**
 * Demo-Daten für den Demo-Modus. Alle Datumswerte relativ zu `now`, damit „überfällig“,
 * „diesen Monat“ usw. nach jedem Reset stimmen. Fiktive Firma, Adressen und @example.com-Mails.
 */

const TAX = 19;
const round2 = (n) => Math.round(n * 100) / 100;

/** YYYY-MM-DD (lokal) für now + offsetDays. */
function day(now, offsetDays) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Zeitstempel für created_at: hält die Erzeugungsreihenfolge (Nummernvergabe sortiert nach created_at). */
function stamp(now, offsetDays, seq) {
  const d = new Date(now);
  d.setHours(8, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  d.setSeconds(seq);
  return d.toISOString();
}

const COMPANY = {
  name: 'Mustermann Haustechnik GmbH',
  address: 'Musterstraße 1',
  city: 'Musterstadt',
  postal_code: '12345',
  country: 'Deutschland',
  phone: '+49 123 456789-0',
  email: 'info@mustermann-haustechnik.example.com',
  website: 'www.mustermann-haustechnik.example.com',
  tax_id: 'DE123456789',
  tax_identification_number: '012/345/67890',
  payment_account_holder: 'Mustermann Haustechnik GmbH',
  payment_bank_account: 'DE02120300000000202051',
  payment_bic: 'BYLADEM1001',
  payment_bank_name: 'Musterbank',
  payment_terms: 'Bei Zahlungsverzug berechnen wir Verzugszinsen in gesetzlicher Höhe.',
  reminder_text_stage_1: 'sicher ist Ihnen im Alltag entgangen, dass die unten genannte Rechnung noch offen ist. Wir bitten um Begleichung innerhalb von 7 Tagen.',
  reminder_text_stage_2: 'leider konnten wir trotz unserer Zahlungserinnerung noch keinen Zahlungseingang feststellen. Bitte überweisen Sie den offenen Betrag umgehend.',
  reminder_text_stage_3: 'trotz zweifacher Mahnung ist die Rechnung weiterhin offen. Ohne Zahlungseingang innerhalb von 7 Tagen übergeben wir den Vorgang an ein Inkassobüro.',
};

// [Name, Straße, PLZ, Ort, Mail-Kürzel, Telefon]
const CUSTOMERS = [
  ['Bäckerei Sonnenschein', 'Brotgasse 3', '12345', 'Musterstadt', 'baeckerei-sonnenschein', '0123 11111'],
  ['Architekturbüro Lindner & Partner', 'Planstraße 120', '12347', 'Musterstadt', 'lindner-partner', '0123 22222'],
  ['Hausverwaltung Weber KG', 'Schillerweg 44', '12350', 'Beispielheim', 'hv-weber', '0123 33333'],
  ['Café Morgenrot', 'Bergstraße 210', '12345', 'Musterstadt', 'cafe-morgenrot', '0123 44444'],
  ['Zahnarztpraxis Dr. Hoffmann', 'Kurplatz 1', '12360', 'Bad Beispiel', 'praxis-hoffmann', '0123 55555'],
  ['Autohaus Becker GmbH', 'Industriestraße 15', '12370', 'Musterdorf', 'autohaus-becker', '0123 66666'],
  ['Erika Musterfrau', 'Gartenweg 7', '12345', 'Musterstadt', 'e.musterfrau', '0170 1234567'],
  ['Max Beispiel', 'Lindenallee 22', '12350', 'Beispielheim', 'max.beispiel', '0171 7654321'],
];

const HOURLY_RATES = [
  ['Meisterstunde', 'Arbeitsstunde Meister', 78, true],
  ['Gesellenstunde', 'Arbeitsstunde Geselle', 64, false],
  ['Auszubildende/r', 'Arbeitsstunde Auszubildende/r', 38, false],
  ['Notdienst', 'Einsatz außerhalb der Geschäftszeiten', 115, false],
];

const MATERIALS = [
  ['NYM-J 3x1,5 mm²', 'Installationsleitung', 1.45, 'm'],
  ['NYM-J 5x2,5 mm²', 'Installationsleitung', 3.2, 'm'],
  ['Schuko-Steckdose UP', 'Unterputz, reinweiß', 8.9, 'Stück'],
  ['LED-Panel 60x60', '40 W, neutralweiß', 64, 'Stück'],
  ['FI/LS-Schalter B16', '30 mA, 2-polig', 49, 'Stück'],
  ['Kupferrohr 15 mm', 'Heizung/Sanitär', 9.8, 'm'],
  ['Thermostatkopf', 'Mit Nullstellung', 14.5, 'Stück'],
  ['Anfahrt', 'Pauschale im Stadtgebiet', 39, 'Pauschal'],
];

const item = (description, quantity, unitPrice) => ({ description, quantity, unitPrice });

// [Kunde, Ausstellung (Tage), Zahlungsziel (Tage), Status, Positionen, Mahnung vor (Tage) | null]
const INVOICES = [
  [0, -170, 14, 'paid', [item('Wartung Lüftungsanlage Backstube', 1, 480), item('Filtersatz', 2, 65)]],
  [1, -150, 14, 'paid', [item('Elektroinstallation Büroetage', 32, 64), item('Kabel & Kleinmaterial', 1, 420)]],
  [2, -132, 30, 'paid', [item('Treppenhausbeleuchtung LED-Umrüstung', 1, 2350)]],
  [6, -118, 14, 'paid', [item('Heizkörper tauschen Wohnzimmer', 1, 690), item('Gesellenstunde', 4, 64)]],
  [3, -101, 14, 'paid', [item('Montage Thekenbeleuchtung', 6, 64), item('LED-Profile', 4, 89)]],
  [1, -88, 14, 'paid', [item('Smart-Home-Nachrüstung Besprechungsräume', 1, 3890)]],
  [4, -75, 14, 'reminded_2x', [item('Prüfung ortsveränderlicher Geräte (DGUV V3)', 48, 9.5)], -20],
  [5, -60, 14, 'reminded_1x', [item('Ladesäulen-Installation 22 kW', 2, 1450), item('Anfahrt', 1, 39)], -12],
  [7, -45, 14, 'overdue', [item('Badsanierung Elektro', 1, 980)]],
  [2, -38, 14, 'overdue', [item('Rohrbruch Notdienst', 3, 115), item('Kupferrohr 15 mm', 4, 9.8)]],
  [0, -21, 14, 'sent', [item('Reparatur Teigknetmaschine', 3, 64), item('Ersatzteil Antriebsriemen', 1, 115)]],
  [2, -14, 30, 'sent', [item('Wohnung 3. OG: Elektrik-Sanierung', 18, 64), item('Unterverteilung', 1, 640)]],
  [1, -6, 14, 'sent', [item('Netzwerkverkabelung Cat7, 12 Dosen', 12, 95)]],
  [3, -3, 14, 'draft', [item('Außenbeleuchtung Terrasse', 5, 64), item('Wandleuchten IP65', 6, 74)]],
  [6, -2, 14, 'draft', [item('Thermostatköpfe tauschen', 6, 14.5), item('Gesellenstunde', 2, 64)]],
  [5, -1, 14, 'draft', [item('Werkstattbeleuchtung Hallenstrahler', 10, 189), item('Meisterstunde', 8, 78)]],
];

// [Kunde, Ausstellung (Tage), Status, Positionen, umgewandelt in Rechnung Nr. (Index in INVOICES) | null]
const QUOTES = [
  [1, -95, 'billed', [item('Smart-Home-Nachrüstung Besprechungsräume', 1, 3890)], 5],
  [5, -30, 'rejected', [item('Photovoltaik-Anlage 30 kWp', 1, 38900)], null],
  [4, -18, 'accepted', [item('Praxisumbau Elektro, Pauschale', 1, 7450), item('Röntgenraum Sonderinstallation', 1, 1980)], null],
  [7, -10, 'sent', [item('Wallbox-Installation inkl. Zuleitung', 1, 1690)], null],
  [3, -2, 'draft', [item('Photovoltaik-Beratung inkl. Planung', 1, 450)], null],
];

// [Kunde, Titel, Beschreibung, Datum (Tage), Status, Priorität, Stunden, Satz-Index, Material [Index, Menge][]]
const JOBS = [
  [2, 'Zählerschrank erneuern', 'Altbau Schillerweg, Hauptverteilung tauschen', -9, 'invoiced', 'high', 6.5, 0, [[4, 3], [1, 12]]],
  [6, 'Heizkörper entlüften', 'Alle Heizkörper im EG und OG', -7, 'completed', 'low', 1.5, 1, [[7, 1]]],
  [0, 'Backofen-Anschluss prüfen', 'Sicherung fliegt sporadisch, Fehlersuche', -1, 'in-progress', 'medium', 2, 1, [[2, 1]]],
  [4, 'Praxisumbau Vorbereitung', 'Leerrohre im Behandlungsraum 2 verlegen', 0, 'in-progress', 'high', 4, 0, [[0, 40]]],
  [5, 'Wallbox Kundenparkplatz', 'Zweite Ladesäule vorbereiten, Leerrohr verlegen', 4, 'draft', 'low', 0, 1, []],
  [7, 'Außensteckdose Garten', 'Wetterfeste Steckdose an der Terrasse', 6, 'draft', 'medium', 0, 2, []],
];

function invoiceTotals(items) {
  const subtotal = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const taxAmount = round2(subtotal * TAX / 100);
  return { subtotal, taxAmount, total: round2(subtotal + taxAmount) };
}

/** Fortlaufende Nummern je Jahr (Präfix-YYYY-NNN), wie in invoiceService/quoteService. */
function numberer(prefix) {
  const counters = new Map();
  return (date) => {
    const year = date.slice(0, 4);
    const next = (counters.get(year) || 0) + 1;
    counters.set(year, next);
    return `${prefix}-${year}-${String(next).padStart(3, '0')}`;
  };
}

async function insertItems(client, table, parentColumn, parentId, items) {
  for (const [index, i] of items.entries()) {
    await client.query(
      `INSERT INTO ${table} (${parentColumn}, description, quantity, unit_price, tax_rate, total, item_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [parentId, i.description, i.quantity, i.unitPrice, TAX, round2(i.quantity * i.unitPrice), index + 1]
    );
  }
}

export async function seedDemoData(client, now) {
  const c = COMPANY;
  await client.query(
    `INSERT INTO company (
       id, name, address, city, postal_code, country, phone, email, website, tax_id, tax_identification_number,
       primary_color, secondary_color, locale,
       job_tracking_enabled, reporting_enabled, quotes_enabled, discounts_enabled, reminders_enabled,
       default_payment_days, reminder_days_after_due, reminder_days_between,
       reminder_fee_stage_1, reminder_fee_stage_2, reminder_fee_stage_3,
       reminder_text_stage_1, reminder_text_stage_2, reminder_text_stage_3,
       payment_account_holder, payment_bank_account, payment_bic, payment_bank_name, payment_terms
     ) VALUES (
       1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       '#0f766e', '#475569', 'de-DE',
       true, true, true, true, true,
       14, 7, 7,
       0, 5, 10,
       $11, $12, $13,
       $14, $15, $16, $17, $18
     )`,
    [c.name, c.address, c.city, c.postal_code, c.country, c.phone, c.email, c.website, c.tax_id, c.tax_identification_number,
      c.reminder_text_stage_1, c.reminder_text_stage_2, c.reminder_text_stage_3,
      c.payment_account_holder, c.payment_bank_account, c.payment_bic, c.payment_bank_name, c.payment_terms]
  );

  const rateIds = [];
  for (const [name, description, rate, isDefault] of HOURLY_RATES) {
    const { rows } = await client.query(
      'INSERT INTO hourly_rates (name, description, rate, tax_rate, is_default) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, description, rate, TAX, isDefault]
    );
    rateIds.push(rows[0].id);
  }

  for (const [index, [name, description, unitPrice, unit]] of MATERIALS.entries()) {
    await client.query(
      'INSERT INTO material_templates (name, description, unit_price, unit, tax_rate, is_default) VALUES ($1, $2, $3, $4, $5, $6)',
      [name, description, unitPrice, unit, TAX, index === 0]
    );
  }

  const customers = [];
  for (const [index, [name, address, postalCode, city, mail, phone]] of CUSTOMERS.entries()) {
    const email = mail.includes('.') ? `${mail}@example.com` : `kontakt@${mail}.example.com`;
    const { rows } = await client.query(
      `INSERT INTO customers (customer_number, name, email, address, city, postal_code, country, phone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'Deutschland', $7, $8) RETURNING id, name`,
      [String(index + 1).padStart(4, '0'), name, email, address, city, postalCode, phone, stamp(now, -200, index)]
    );
    customers.push(rows[0]);
  }

  // Kundenspezifische Preise: Hausverwaltung mit Rahmenvertrag
  await client.query(
    `INSERT INTO customer_specific_hourly_rates (customer_id, name, description, rate, tax_rate, is_default)
     VALUES ($1, 'Rahmenvertrag Stunde', 'Vereinbarter Satz laut Rahmenvertrag', 58, $2, true)`,
    [customers[2].id, TAX]
  );
  await client.query(
    `INSERT INTO customer_specific_materials (customer_id, name, description, unit_price, unit, tax_rate)
     VALUES ($1, 'LED-Panel 60x60 (Rahmenvertrag)', '40 W, neutralweiß', 55, 'Stück', $2)`,
    [customers[2].id, TAX]
  );

  const nextInvoiceNumber = numberer('RE');
  const invoiceIds = [];
  for (const [seq, [ci, issue, term, status, items, reminderAgo]] of INVOICES.entries()) {
    const issueDate = day(now, issue);
    const { subtotal, taxAmount, total } = invoiceTotals(items);
    const stage = status === 'reminded_2x' ? 2 : status === 'reminded_1x' ? 1 : 0;
    const reminderDate = reminderAgo == null ? null : day(now, reminderAgo);
    const { rows } = await client.query(
      `INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total,
         status, last_reminder_date, last_reminder_sent_at, max_reminder_stage, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [nextInvoiceNumber(issueDate), customers[ci].id, customers[ci].name, issueDate, day(now, issue + term),
        subtotal, taxAmount, total, status, reminderDate, reminderDate ? `${reminderDate}T09:00:00Z` : null, stage,
        stamp(now, issue, seq)]
    );
    invoiceIds.push(rows[0].id);
    await insertItems(client, 'invoice_items', 'invoice_id', rows[0].id, items);
  }

  const nextQuoteNumber = numberer('AN');
  for (const [seq, [ci, issue, status, items, invoiceIndex]] of QUOTES.entries()) {
    const issueDate = day(now, issue);
    const { subtotal, taxAmount, total } = invoiceTotals(items);
    const { rows } = await client.query(
      `INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total,
         status, converted_to_invoice_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [nextQuoteNumber(issueDate), customers[ci].id, customers[ci].name, issueDate, day(now, issue + 30),
        subtotal, taxAmount, total, status, invoiceIndex == null ? null : invoiceIds[invoiceIndex], stamp(now, issue, seq)]
    );
    await insertItems(client, 'quote_items', 'quote_id', rows[0].id, items);
  }

  // Auftragsnummern wie routes/jobs.js: AB-<aktuelles Jahr>-NNN
  const jobYear = String(now.getFullYear());
  for (const [seq, [ci, title, description, date, status, priority, hours, rateIndex, materialRefs]] of JOBS.entries()) {
    const hourlyRate = HOURLY_RATES[rateIndex][2];
    const materials = materialRefs.map(([mi, quantity], index) => {
      const [name, , unitPrice, unit] = MATERIALS[mi];
      return { id: `demo-material-${seq}-${index}`, description: name, quantity, unitPrice, taxRate: TAX, unit, total: round2(quantity * unitPrice) };
    });
    const { rows } = await client.query(
      `INSERT INTO job_entries (job_number, customer_id, customer_address, title, description, date, hours_worked, hourly_rate,
         hourly_rate_id, materials, status, priority, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING id`,
      [`AB-${jobYear}-${String(seq + 1).padStart(3, '0')}`, customers[ci].id, `${CUSTOMERS[ci][1]}, ${CUSTOMERS[ci][2]} ${CUSTOMERS[ci][3]}`,
        title, description, day(now, date), hours, hourlyRate, rateIds[rateIndex], JSON.stringify(materials), status, priority,
        stamp(now, Math.min(date, 0), seq)]
    );
    if (hours > 0) {
      await client.query(
        `INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
         VALUES ($1, $2, '08:00', $3, $4, $5, $6, $7, $8)`,
        [rows[0].id, title, `${String(8 + Math.floor(hours)).padStart(2, '0')}:${hours % 1 ? '30' : '00'}`,
          hours, hourlyRate, rateIds[rateIndex], TAX, round2(hours * hourlyRate)]
      );
    }
  }
}
