// Sperre freigegebener Rechnungen (GoBD): nach der Freigabe nur noch Statuswechsel.
// Spec: docs/superpowers/specs/2026-11-17-document-archive-storno.md § 2
//
// Das Frontend schickt beim Statuswechsel teils ganze Rechnungsobjekte. Ein Feld gilt nur dann als
// Änderung, wenn updateInvoice den gespeicherten Wert tatsächlich überschreiben würde – fehlende
// bzw. null-Felder behält updateInvoice (??), sie werden daher nicht verglichen.

const RELEASED_STATUSES = ['sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'];

const MSG_LOCKED = 'Freigegebene Rechnungen können nicht mehr geändert werden. Korrekturen bitte über eine Stornorechnung.';
const MSG_CANCELLED = 'Stornierte Rechnungen können nicht mehr geändert werden.';
const MSG_CANCEL_VIA_STORNO = 'Rechnungen werden über „Stornieren“ storniert, nicht über den Status.';
const MSG_BACK_TO_DRAFT = 'Die Rechnung wurde bereits ausgegeben und archiviert und kann nicht mehr zum Entwurf werden.';
const MSG_DELETE = 'Freigegebene Rechnungen können nicht gelöscht werden. Korrekturen bitte über eine Stornorechnung.';

export function lockedError(message, fields) {
  return Object.assign(new Error(message), { statusCode: 409, code: 'INVOICE_LOCKED', fields });
}

const isSet = (v) => v !== undefined && v !== null;

/** Wie Postgres einen Wert in einer DATE-Spalte speichern würde (Zeitanteil wird verworfen). */
function payloadDate(v) {
  return String(v).slice(0, 10);
}

/** pg liefert DATE als Date um lokale Mitternacht. */
function storedDate(v) {
  if (!(v instanceof Date)) return String(v).slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

/** DECIMAL(…,2): Vergleich in Cent, null/'' = 0. */
function cents(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const text = (v) => (v === null || v === undefined || v === '' ? null : String(v));

function itemsChanged(payloadItems, storedItems) {
  if (!Array.isArray(payloadItems)) return true;
  if (payloadItems.length !== storedItems.length) return true;
  return payloadItems.some((item, i) => {
    const stored = storedItems[i];
    if (!item || typeof item !== 'object') return true;
    if (text(item.description) !== text(stored.description)) return true;
    for (const [key, col] of [['quantity', 'quantity'], ['unitPrice', 'unit_price'], ['taxRate', 'tax_rate']]) {
      if (cents(item[key]) !== cents(stored[col])) return true;
    }
    // Rabattfelder fehlen in manchen Antworten (findInvoiceById) – nur vergleichen, wenn mitgeschickt.
    if (item.discountType !== undefined && text(item.discountType) !== text(stored.discount_type)) return true;
    for (const [key, col] of [['discountValue', 'discount_value'], ['discountAmount', 'discount_amount']]) {
      if (item[key] !== undefined && cents(item[key]) !== cents(stored[col])) return true;
    }
    const order = item.order ?? i + 1;
    return Number(order) !== Number(stored.item_order ?? 1);
  });
}

function attachmentsChanged(payloadAttachments, storedAttachments) {
  if (!Array.isArray(payloadAttachments)) return true;
  if (payloadAttachments.some((a) => !a || !a.id)) return true;
  const ids = (list) => list.map((a) => String(a.id)).sort();
  return JSON.stringify(ids(payloadAttachments)) !== JSON.stringify(ids(storedAttachments));
}

/** Liste der Felder, die updateInvoice gegenüber dem gespeicherten Stand ändern würde. */
export function changedFields(current, currentItems, currentAttachments, data) {
  const changed = [];
  const compare = (field, a, b) => { if (a !== b) changed.push(field); };

  if (isSet(data.customerId)) compare('customerId', String(data.customerId), String(current.customer_id));
  if (isSet(data.customerName)) compare('customerName', text(data.customerName), text(current.customer_name));
  if (isSet(data.issueDate)) compare('issueDate', payloadDate(data.issueDate), storedDate(current.issue_date));
  if (isSet(data.dueDate)) compare('dueDate', payloadDate(data.dueDate), storedDate(current.due_date));
  if (isSet(data.notes)) compare('notes', text(data.notes), text(current.notes));
  if (isSet(data.globalDiscountType)) compare('globalDiscountType', text(data.globalDiscountType), text(current.global_discount_type));
  for (const [key, col] of [
    ['subtotal', 'subtotal'], ['taxAmount', 'tax_amount'], ['total', 'total'],
    ['globalDiscountValue', 'global_discount_value'], ['globalDiscountAmount', 'global_discount_amount'],
  ]) {
    if (isSet(data[key])) compare(key, cents(data[key]), cents(current[col]));
  }
  if (isSet(data.items) && itemsChanged(data.items, currentItems)) changed.push('items');
  if (isSet(data.attachments) && attachmentsChanged(data.attachments, currentAttachments)) changed.push('attachments');
  return changed;
}

/**
 * Wirft 409 INVOICE_LOCKED, wenn das Update an einer freigegebenen Rechnung mehr als einen
 * erlaubten Statuswechsel bewirken würde. `cancelled` setzt nur der Storno-Service.
 */
export function assertUpdateAllowed(current, currentItems, currentAttachments, data, hasArchive) {
  const nextStatus = data.status ?? current.status;
  if (data.status === 'cancelled' && current.status !== 'cancelled') throw lockedError(MSG_CANCEL_VIA_STORNO);
  if (current.status === 'draft') return;
  if (current.status === 'cancelled') throw lockedError(MSG_CANCELLED);

  if (nextStatus !== current.status) {
    if (nextStatus === 'draft') {
      if (hasArchive) throw lockedError(MSG_BACK_TO_DRAFT);
    } else if (!RELEASED_STATUSES.includes(nextStatus)) {
      throw lockedError(MSG_LOCKED);
    }
  }

  const fields = changedFields(current, currentItems, currentAttachments, data);
  if (fields.length > 0) throw lockedError(MSG_LOCKED, fields);
}

export function assertDeleteAllowed(current) {
  if (current.status !== 'draft') throw lockedError(MSG_DELETE);
}
