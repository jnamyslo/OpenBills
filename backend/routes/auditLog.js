import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

const PAGE_SIZE = 50;
const CSV_MAX_ROWS = 100000;
const MAX_INT4 = 2147483647;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class QueryError extends Error {}

function parseDate(value, name) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new QueryError(`Ungültiges Datum für "${name}" (erwartet: JJJJ-MM-TT)`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new QueryError(`Ungültiges Datum für "${name}" (erwartet: JJJJ-MM-TT)`);
  }
  return value;
}

function buildFilters(q) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  const from = parseDate(q.from, 'from');
  const to = parseDate(q.to, 'to');
  if (from) add('at >= ?::date', from);
  if (to) add("at < (?::date + 1)", to);

  if (q.userId !== undefined && q.userId !== '') {
    if (q.userId === 'operator') {
      where.push('is_operator = true');
    } else if (typeof q.userId === 'string' && /^\d{1,10}$/.test(q.userId) && Number(q.userId) <= MAX_INT4) {
      add('user_id = ?', Number(q.userId));
    } else {
      throw new QueryError('Ungültige Nutzer-ID');
    }
  }

  if (q.action !== undefined && q.action !== '') {
    if (typeof q.action !== 'string' || q.action.length > 100) {
      throw new QueryError('Ungültige Aktion (maximal 100 Zeichen)');
    }
    add("action LIKE ? || '%'", q.action.replace(/[\\%_]/g, '\\$&'));
  }

  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function parsePage(value) {
  if (value === undefined || value === '') return 1;
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) < 1) {
    throw new QueryError('Ungültige Seitenzahl');
  }
  return Number(value);
}

function toEntry(r) {
  return {
    id: Number(r.id),
    at: r.at instanceof Date ? r.at.toISOString() : r.at,
    actorLabel: r.actor_label,
    isOperator: r.is_operator,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    details: r.details,
    ip: r.ip,
  };
}

function csvField(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const lines = ['Zeitpunkt;Nutzer;Support-Zugang;Aktion;Objekt;Objekt-ID;IP'];
  for (const r of rows) {
    lines.push([
      r.at instanceof Date ? r.at.toISOString() : r.at,
      r.actor_label,
      r.is_operator ? 'ja' : 'nein',
      r.action,
      r.entity_type,
      r.entity_id,
      r.ip,
    ].map(csvField).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

router.get('/', async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query);

    if (req.query.format === 'csv') {
      const { rows } = await query(
        `SELECT * FROM audit_log ${where} ORDER BY at DESC, id DESC LIMIT ${CSV_MAX_ROWS}`,
        params,
      );
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="audit-log.csv"');
      return res.send(toCsv(rows));
    }

    const page = parsePage(req.query.page);
    const { rows: countRows } = await query(`SELECT COUNT(*) AS total FROM audit_log ${where}`, params);
    const { rows } = await query(
      `SELECT * FROM audit_log ${where} ORDER BY at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
      [...params, (page - 1) * PAGE_SIZE],
    );
    res.json({
      entries: rows.map(toEntry),
      total: Number(countRows[0].total),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    if (err instanceof QueryError) return res.status(400).json({ error: err.message });
    logger.error('Audit-Log konnte nicht geladen werden', { error: err.message });
    res.status(500).json({ error: 'Audit-Log konnte nicht geladen werden' });
  }
});

export default router;
