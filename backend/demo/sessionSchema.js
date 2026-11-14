import { pool, runWithSchema } from '../database.js';
import logger from '../utils/logger.js';
import { BACKUP_TABLES } from '../utils/backupTables.js';
import { isDemoMode } from './index.js';
import { seedDemoData } from './seed.js';

/**
 * Demo: jede Sitzung arbeitet auf einer eigenen Kopie der Demo-Daten (eigenes Postgres-Schema).
 * - `demo_template` hält die Demo-Daten (Seed), nie direkt von Besuchern genutzt.
 * - `demo_s_<hash>` je Sitzung, beim ersten Request der Sitzung aus der Vorlage kopiert,
 *   beim Logout bzw. nach Ablauf der Sitzung gelöscht.
 * - Auth-Tabellen (users, sessions, …) bleiben gemeinsam in `public` (search_path: Sitzung, public).
 * - Die App-Tabellen in `public` bleiben in der Demo leer.
 */

export const TEMPLATE_SCHEMA = 'demo_template';
const SESSION_PREFIX = 'demo_s_';
export const MAX_DEMO_SESSIONS = 100;

// Ein Advisory-Lock für alle Änderungen an Demo-Schemas (Vorlage, Sitzungen, Reset).
export const DEMO_LOCK_KEY = 4711_2026;

// Je Sitzung kopiert. audit_log auch, damit niemand Aktionen/IPs anderer Besucher sieht.
export const SESSION_TABLES = [...BACKUP_TABLES, 'usage_counters', 'audit_log'];

// Nur im Speicher: Schemas, deren Existenz dieser Prozess bestätigt hat (spart die Prüfung je Request).
const readySchemas = new Set();

export function sessionSchemaName(session) {
  return SESSION_PREFIX + session.id_hash.slice(0, 32);
}

export async function lockDemoSchemas(client) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [DEMO_LOCK_KEY]);
}

async function schemaExists(client, schema) {
  const { rows } = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
  return rows.length > 0;
}

/**
 * Legt `target` mit der Struktur der App-Tabellen aus `public` an (Spalten, Defaults, Checks, Indizes,
 * eigene Sequenzen, Fremdschlüssel, Trigger) und kopiert optional die Daten aus `dataFrom`.
 * Erwartet eine offene Transaktion mit Standard-search_path; setzt search_path lokal auf `target, public`.
 */
export async function cloneSchema(client, target, { dataFrom = null } = {}) {
  const id = (name) => client.escapeIdentifier(name);
  const t = id(target);

  // Vor dem Umstellen des search_path lesen: so liefern pg_get_* unqualifizierte Tabellennamen.
  const { rows: serials } = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
        AND pg_get_serial_sequence(format('public.%I', table_name), column_name) IS NOT NULL`,
    [SESSION_TABLES]
  );
  const { rows: foreignKeys } = await client.query(
    `SELECT cl.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public' AND cl.relname = ANY($1)`,
    [SESSION_TABLES]
  );
  const { rows: triggers } = await client.query(
    `SELECT pg_get_triggerdef(tg.oid) AS def
       FROM pg_trigger tg
       JOIN pg_class cl ON cl.oid = tg.tgrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE NOT tg.tgisinternal AND n.nspname = 'public' AND cl.relname = ANY($1)`,
    [SESSION_TABLES]
  );

  await client.query(`CREATE SCHEMA ${t}`);
  for (const table of SESSION_TABLES) {
    await client.query(
      `CREATE TABLE ${t}.${id(table)} (LIKE public.${id(table)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`
    );
  }
  // LIKE übernimmt nextval() auf die Sequenz in public – eigene Sequenzen anlegen.
  for (const { table_name: table, column_name: column } of serials) {
    const seq = `${t}.${id(`${table}_${column}_seq`)}`;
    await client.query(`CREATE SEQUENCE ${seq} OWNED BY ${t}.${id(table)}.${id(column)}`);
    await client.query(`ALTER TABLE ${t}.${id(table)} ALTER COLUMN ${id(column)} SET DEFAULT nextval(${client.escapeLiteral(seq)}::regclass)`);
  }

  if (dataFrom) {
    const src = id(dataFrom);
    for (const table of SESSION_TABLES) {
      await client.query(`INSERT INTO ${t}.${id(table)} SELECT * FROM ${src}.${id(table)}`);
    }
    for (const { table_name: table, column_name: column } of serials) {
      const seqName = id(`${table}_${column}_seq`);
      await client.query(
        `SELECT setval(${client.escapeLiteral(`${t}.${seqName}`)}, last_value, is_called) FROM ${src}.${seqName}`
      );
    }
  }

  // Fremdschlüssel/Trigger mit unqualifizierten Namen: zeigen so auf die Kopie (bzw. public für users).
  await client.query(`SET LOCAL search_path TO ${t}, public`);
  for (const { table_name: table, conname, def } of foreignKeys) {
    await client.query(`ALTER TABLE ${id(table)} ADD CONSTRAINT ${id(conname)} ${def}`);
  }
  for (const { def } of triggers) {
    await client.query(def.replace(' ON public.', ' ON '));
  }
}

/** Baut die Demo-Vorlage neu (Struktur aus public, Daten per `seed`). Erwartet Transaktion + Lock. */
export async function buildTemplate(client, { now, seed }) {
  await client.query(`DROP SCHEMA IF EXISTS ${client.escapeIdentifier(TEMPLATE_SCHEMA)} CASCADE`);
  await cloneSchema(client, TEMPLATE_SCHEMA);
  await seed(client, now);
}

async function dropSchema(client, schema) {
  readySchemas.delete(schema);
  await client.query(`DROP SCHEMA IF EXISTS ${client.escapeIdentifier(schema)} CASCADE`);
}

/** Löscht Sitzungs-Schemas ohne gültige Sitzung. Erwartet Transaktion + Lock. */
export async function dropOrphanSchemas(client) {
  const { rows } = await client.query(
    `SELECT nspname FROM pg_namespace n
      WHERE left(nspname, $2) = $1
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE $1 || left(s.id_hash, 32) = n.nspname)`,
    [SESSION_PREFIX, SESSION_PREFIX.length]
  );
  for (const { nspname } of rows) await dropSchema(client, nspname);
  return rows.length;
}

/** Bei voller Demo: älteste Sitzungen (nach letzter Aktivität) beenden. Erwartet Transaktion + Lock. */
async function evictOldestSessions(client) {
  await dropOrphanSchemas(client);
  const { rows } = await client.query(
    `SELECT s.id_hash, n.nspname
       FROM sessions s
       JOIN pg_namespace n ON n.nspname = $1 || left(s.id_hash, 32)
      ORDER BY s.last_seen_at`,
    [SESSION_PREFIX]
  );
  for (const row of rows.slice(0, Math.max(rows.length - MAX_DEMO_SESSIONS + 1, 0))) {
    await client.query('DELETE FROM sessions WHERE id_hash = $1', [row.id_hash]);
    await dropSchema(client, row.nspname);
  }
}

async function withDemoLock(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockDemoSchemas(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSessionSchema(schema) {
  if (readySchemas.has(schema)) return;
  await withDemoLock(async (client) => {
    if (await schemaExists(client, schema)) return;
    await evictOldestSessions(client);
    await cloneSchema(client, schema, { dataFrom: TEMPLATE_SCHEMA });
    logger.info('Demo: Sitzungsdaten angelegt');
  });
  readySchemas.add(schema);
}

export async function dropSessionSchema(schema) {
  await withDemoLock((client) => dropSchema(client, schema));
}

export async function cleanupDemoSchemas() {
  if (!isDemoMode()) return 0;
  return withDemoLock(dropOrphanSchemas);
}

/** Vorlage auffrischen (Datumswerte relativ zu jetzt); laufende Sitzungen behalten ihre Kopie. */
export async function refreshDemoTemplate({ now = new Date(), seed = seedDemoData } = {}) {
  if (!isDemoMode()) return;
  await withDemoLock((client) => buildTemplate(client, { now, seed }));
}

/**
 * Hinter den Body-Parsern einhängen (sie verlieren den AsyncLocalStorage-Kontext):
 * alle DB-Zugriffe einer Demo-Sitzung laufen ab hier auf deren eigenem Schema.
 */
export async function demoSessionContext(req, res, next) {
  if (!isDemoMode() || !req.session) return next();
  const schema = sessionSchemaName(req.session);
  try {
    await ensureSessionSchema(schema);
  } catch (error) {
    return next(error);
  }
  req.demoSchema = schema;
  runWithSchema(schema, next);
}
