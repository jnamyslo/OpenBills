// Archivierte Kunden: keine neuen Belege, Stammdaten unverändert (nachträglich erzeugte Fassungen
// sollen dem Original entsprechen). Bestehende Belege bleiben nutzbar, Storno bleibt erlaubt.

const MSG_ARCHIVED = 'Der Kunde ist archiviert. Für neue Belege oder Änderungen bitte zuerst wiederherstellen.';

export function customerArchivedError() {
  return Object.assign(new Error(MSG_ARCHIVED), { statusCode: 409, code: 'CUSTOMER_ARCHIVED' });
}

/** Lädt den Kunden (name, archived_at); wirft bei archiviertem Kunden. `null`, wenn es ihn nicht gibt. */
export async function loadActiveCustomer(client, customerId) {
  const { rows } = await client.query('SELECT name, archived_at FROM customers WHERE id = $1', [customerId]);
  if (rows[0]?.archived_at) throw customerArchivedError();
  return rows[0] ?? null;
}

/** Für Bearbeitungen: nur ein Wechsel auf einen archivierten Kunden ist verboten. */
export async function assertCustomerChangeAllowed(client, currentCustomerId, newCustomerId) {
  if (!newCustomerId || newCustomerId === currentCustomerId) return;
  await loadActiveCustomer(client, newCustomerId);
}

/** Antwort für Route-Handler; true, wenn behandelt. */
export function sendCustomerArchivedError(res, error) {
  if (error?.code !== 'CUSTOMER_ARCHIVED') return false;
  res.status(409).json({ code: error.code, error: error.message });
  return true;
}
