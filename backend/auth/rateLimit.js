import { pool } from '../database.js';

export const LIMITS = {
  perAccount: { limit: 5, windowMs: 15 * 60 * 1000 },
  perIp: { limit: 20, windowMs: 15 * 60 * 1000 },
};

// Zählt den Versuch atomar vor der Prüfung (kein Check-then-Act unter Parallelität).
// Liefert 0, wenn der Versuch erlaubt ist, sonst Sekunden bis Fensterende (Retry-After).
export async function reserveAttempt(key, limit, windowMs) {
  const { rows } = await pool.query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start + ($2 * interval '1 millisecond') <= now() THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start + ($2 * interval '1 millisecond') <= now() THEN now() ELSE rate_limits.window_start END
     RETURNING count, window_start + ($2 * interval '1 millisecond') AS window_end`,
    [key, windowMs]
  );
  const { count, window_end: windowEnd } = rows[0];
  if (count <= limit) return 0;
  return Math.max(1, Math.ceil((new Date(windowEnd).getTime() - Date.now()) / 1000));
}

export async function releaseAttempt(key) {
  await pool.query('UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE key = $1', [key]);
}

export async function clearRateLimit(key) {
  await pool.query('DELETE FROM rate_limits WHERE key = $1', [key]);
}

export async function cleanupRateLimits() {
  await pool.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
