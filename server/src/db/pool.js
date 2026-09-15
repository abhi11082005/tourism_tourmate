import pg from 'pg';
import { env, isProd } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Postgres NUMERIC arrives as a string to preserve precision. Money stays a string
// all the way to the client; only the seat-math helpers parse it, in paise/cents.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
// DATE without time — keep the calendar day, never shift it through a JS timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.PGPOOL_MAX,
  idleTimeoutMillis: env.PGPOOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: 5_000,
  ssl: isProd ? { rejectUnauthorized: false } : false,
});


pool.on('error', (err) => {
  // Idle client blew up (network drop, failover). Pool replaces it; just record it.
  logger.error({ err }, 'idle postgres client error');
});

/**
 * Parameterised query. Never interpolate user input into SQL — always pass $n params.
 * @param {string} text
 * @param {unknown[]} [params]
 */
export async function query(text, params) {
  const startedAt = process.hrtime.bigint();
  try {
    return await pool.query(text, params);
  } finally {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (ms > 300) logger.warn({ ms, sql: text.slice(0, 120) }, 'slow query');
  }
}

/** Single row or null. */
export async function queryOne(text, params) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction on a dedicated client.
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @param {{ isolation?: 'READ COMMITTED'|'REPEATABLE READ'|'SERIALIZABLE' }} [opts]
 * @returns {Promise<T>}
 */
export async function withTransaction(fn, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query(
      opts.isolation ? `BEGIN ISOLATION LEVEL ${opts.isolation}` : 'BEGIN'
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
