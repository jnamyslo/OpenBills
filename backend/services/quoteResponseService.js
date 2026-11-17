/**
 * Kundenantwort auf Angebote per Mail-Link (annehmen/ablehnen, ohne Login).
 * Siehe docs/superpowers/specs/2026-11-17-quote-response-link.md
 */
import crypto from 'node:crypto';
import { pool, query } from '../database.js';
import { findQuoteById } from '../queries/quoteQueries.js';
import { generateToken, hashToken } from '../auth/crypto.js';
import { getAuthConfig } from '../auth/config.js';

export const DECISIONS = new Set(['accepted', 'rejected']);
export const MAX_NAME_LENGTH = 200;
export const MAX_COMMENT_LENGTH = 2000;

/** Nur http(s)-Links (wird auf der öffentlichen Seite als href gerendert). */
export function isSafeTermsUrl(value) {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value.trim());
}

// pg liefert DATE als lokale Mitternacht; als YYYY-MM-DD stabil vergleichbar.
function dateKey(value) {
  if (!(value instanceof Date)) return String(value ?? '');
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Fingerabdruck des Angebotsinhalts: ändert sich das Angebot nach dem Versand, wird der Link ungültig. */
export function quoteFingerprint(quote) {
  const content = {
    customerId: quote.customerId,
    validUntil: dateKey(quote.validUntil),
    subtotal: num(quote.subtotal),
    taxAmount: num(quote.taxAmount),
    total: num(quote.total),
    globalDiscount: [quote.globalDiscountType ?? null, num(quote.globalDiscountValue), num(quote.globalDiscountAmount)],
    items: (quote.items || []).map((i) => [
      i.description, num(i.quantity), num(i.unitPrice), num(i.taxRate), num(i.total),
      i.discountType ?? null, num(i.discountValue), num(i.discountAmount),
    ]),
  };
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export function quoteResponseLink(token) {
  return `${getAuthConfig().publicUrl.replace(/\/+$/, '')}/#angebot/${token}`;
}

/** Legt ein Token für den Versand an; gültig bis Ende des Tages valid_until (Europe/Berlin). */
export async function createQuoteResponseToken(quote, recipients) {
  const token = generateToken();
  await query(
    `INSERT INTO quote_responses (token_hash, quote_id, recipients, fingerprint, expires_at)
     SELECT $1, q.id, $3, $4, ((q.valid_until + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
     FROM quotes q WHERE q.id = $2`,
    [hashToken(token), quote.id, recipients.join(', '), quoteFingerprint(quote)]
  );
  return token;
}

export async function deleteQuoteResponseToken(token) {
  await query('DELETE FROM quote_responses WHERE token_hash = $1', [hashToken(token)]);
}

/** Status eines Links (Reihenfolge siehe Spec). */
export function evaluateResponse(row, quote, now = new Date()) {
  if (!row || !quote) return 'invalid';
  if (row.responded_at) return 'answered';
  if (quote.status !== 'sent') return 'closed';
  if (new Date(row.expires_at) <= now) return 'expired';
  if (row.fingerprint !== quoteFingerprint(quote)) return 'changed';
  return 'valid';
}

async function loadCompany() {
  const { rows } = await query('SELECT name, email, primary_color, terms_url FROM company WHERE id = 1');
  const c = rows[0] ?? {};
  return {
    name: c.name ?? '',
    email: c.email ?? '',
    primaryColor: c.primary_color ?? null,
    termsUrl: isSafeTermsUrl(c.terms_url) ? c.terms_url.trim() : null,
  };
}

function publicQuote(quote) {
  return {
    quoteNumber: quote.quoteNumber,
    customerName: quote.customerName,
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    subtotal: quote.subtotal,
    taxAmount: quote.taxAmount,
    total: quote.total,
    items: (quote.items || []).map((i) => ({
      description: i.description,
      quantity: num(i.quantity),
      unitPrice: num(i.unitPrice),
      total: num(i.total),
    })),
  };
}

async function findRow(token) {
  const { rows } = await query('SELECT * FROM quote_responses WHERE token_hash = $1', [hashToken(String(token ?? ''))]);
  return rows[0] ?? null;
}

/** Daten für die öffentliche Seite. Unbekannte Tokens verraten nichts über die Firma. */
export async function getQuoteResponseView(token) {
  const row = await findRow(token);
  const quote = row ? await findQuoteById(row.quote_id) : null;
  const status = evaluateResponse(row, quote);
  if (status === 'invalid') return { status };
  const company = await loadCompany();
  const view = {
    status,
    company: { name: company.name, primaryColor: company.primaryColor, termsUrl: company.termsUrl },
    quote: status === 'valid' ? publicQuote(quote) : { quoteNumber: quote.quoteNumber },
  };
  if (status === 'answered') {
    view.decision = row.decision;
    view.respondedAt = row.responded_at;
  }
  return view;
}

export class QuoteResponseError extends Error {
  constructor(httpStatus, message, body = {}) {
    super(message);
    this.httpStatus = httpStatus;
    this.body = { error: message, ...body };
  }
}

function validateInput({ decision, name, comment, acceptTerms }, termsUrl) {
  if (!DECISIONS.has(decision)) throw new QuoteResponseError(400, 'Ungültige Entscheidung', { code: 'VALIDATION_ERROR' });
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName || cleanName.length > MAX_NAME_LENGTH) {
    throw new QuoteResponseError(400, 'Bitte geben Sie Ihren Namen an.', { code: 'VALIDATION_ERROR' });
  }
  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    throw new QuoteResponseError(400, 'Ungültiger Kommentar', { code: 'VALIDATION_ERROR' });
  }
  const cleanComment = (comment ?? '').trim();
  if (cleanComment.length > MAX_COMMENT_LENGTH) {
    throw new QuoteResponseError(400, `Der Kommentar darf höchstens ${MAX_COMMENT_LENGTH} Zeichen lang sein.`, { code: 'VALIDATION_ERROR' });
  }
  if (decision === 'accepted' && termsUrl && acceptTerms !== true) {
    throw new QuoteResponseError(400, 'Bitte bestätigen Sie die Allgemeinen Geschäftsbedingungen.', { code: 'TERMS_REQUIRED' });
  }
  return { decision, name: cleanName, comment: cleanComment || null };
}

/**
 * Speichert die Kundenentscheidung und setzt den Angebotsstatus (eine Transaktion).
 * Liefert Angebot, Firma und bereinigte Eingabe für Audit und Benachrichtigung.
 */
export async function submitQuoteResponse(token, input, { ip = null, userAgent = null } = {}) {
  const company = await loadCompany();
  const clean = validateInput(input ?? {}, company.termsUrl);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM quote_responses WHERE token_hash = $1 FOR UPDATE',
      [hashToken(String(token ?? ''))]
    );
    const row = rows[0] ?? null;
    if (row) await client.query('SELECT id FROM quotes WHERE id = $1 FOR UPDATE', [row.quote_id]);
    const quote = row ? await findQuoteById(row.quote_id) : null;
    const status = evaluateResponse(row, quote);
    if (status !== 'valid') {
      throw new QuoteResponseError(409, 'Dieser Link kann nicht mehr verwendet werden.', { code: 'LINK_NOT_USABLE', status });
    }
    await client.query('UPDATE quotes SET status = $1 WHERE id = $2', [clean.decision, quote.id]);
    await client.query(
      `UPDATE quote_responses
       SET responded_at = now(), decision = $2, responder_name = $3, comment = $4, terms_url = $5, ip = $6, user_agent = $7
       WHERE token_hash = $1`,
      [
        row.token_hash, clean.decision, clean.name, clean.comment,
        clean.decision === 'accepted' ? company.termsUrl : null,
        ip, userAgent ? String(userAgent).slice(0, 500) : null,
      ]
    );
    await client.query('COMMIT');
    return { quote, company, ...clean };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
