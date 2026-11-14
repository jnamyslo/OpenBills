import { pool } from '../database.js';
import logger from '../utils/logger.js';

export const AUDIT_RETENTION_DAYS = 90;

export async function audit(req, { action, entityType = null, entityId = null, details = null, user = req?.user } = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, actor_label, is_operator, action, entity_type, entity_id, details, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        user?.id ?? null,
        user ? user.name || user.email || null : 'System',
        Boolean(user?.is_operator ?? user?.isOperator),
        action,
        entityType,
        entityId === null || entityId === undefined ? null : String(entityId),
        details === null || details === undefined ? null : JSON.stringify(details),
        req?.ip ?? null,
        req?.get?.('user-agent') ?? null,
      ]
    );
  } catch (err) {
    try {
      logger.error('Audit-Log konnte nicht geschrieben werden', { error: err.message });
    } catch {
      // nie werfen
    }
  }
}

export async function cleanupAuditLog() {
  const { rowCount } = await pool.query(
    `DELETE FROM audit_log WHERE at < now() - ($1 * interval '1 day')`,
    [AUDIT_RETENTION_DAYS]
  );
  return rowCount;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function describeRequest(method, originalUrl) {
  const path = String(originalUrl).split('?')[0].split('#')[0];
  let entityId = null;
  const segments = path.split('/').map((seg) => {
    if (UUID_RE.test(seg) || /^\d+$/.test(seg)) {
      if (entityId === null) entityId = seg;
      return ':id';
    }
    return seg;
  });
  const parts = path.split('/').filter(Boolean);
  const apiIdx = parts.indexOf('api');
  const entityType = apiIdx >= 0 && parts[apiIdx + 1] ? parts[apiIdx + 1] : null;
  return { action: `${method} ${segments.join('/')}`, entityType, entityId };
}
