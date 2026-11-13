import { pool } from '../database.js';

export const LIMITS = {
  perAccount: { limit: 5, windowMs: 15 * 60 * 1000 },
  perIp: { limit: 20, windowMs: 15 * 60 * 1000 },
};

export async function checkRateLimit(key, limit, windowMs) {
  const { rows } = await pool.query(
    `SELECT count, window_start + ($2 * interval '1 millisecond') AS window_end FROM rate_limits WHERE key = $1`,
    [key, windowMs]
  );
  const row = rows[0];
  if (!row || row.count < limit) return 0;
  const remainingMs = new Date(row.window_end).getTime() - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export async function recordAttempt(key, windowMs) {
  await pool.query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start + ($2 * interval '1 millisecond') <= now() THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start + ($2 * interval '1 millisecond') <= now() THEN now() ELSE rate_limits.window_start END`,
    [key, windowMs]
  );
}

export async function clearRateLimit(key) {
  await pool.query('DELETE FROM rate_limits WHERE key = $1', [key]);
}

export async function cleanupRateLimits() {
  await pool.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
