import { env, googleMapsEnabled } from '../config/env.js';
import { redis } from '../db/redis.js';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';

/*
 * The only module that talks to Google Maps Platform from the server.
 *
 *  - The key travels in the X-Goog-Api-Key header, never in a URL, so it cannot
 *    end up in an access log, a proxy log or an error message.
 *  - Every call carries an explicit field mask (Places and Routes both refuse a
 *    request without one) so we pay only for the fields we render.
 *  - Failures are translated into HttpErrors with a stable `code`; Google's raw
 *    error body is logged (status + message only) and never forwarded.
 *
 * Caching, and why it is short: Google's terms do not let us build a database of
 * Places content, so nothing here is persisted. Results are kept for
 * PLACES_CACHE_TTL_SECONDS (default 5 min) purely to collapse identical requests
 * from different visitors and from React re-mounts into one billable call.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1';
const ROUTES_BASE = 'https://routes.googleapis.com';

export function requireGoogle() {
  if (!googleMapsEnabled) {
    throw new HttpError(503, 'Nearby discovery is not configured on this server', {
      code: 'GOOGLE_NOT_CONFIGURED',
    });
  }
}

/**
 * @param {string} url
 * @param {{ method?: string, body?: unknown, fieldMask: string, timeoutMs?: number,
 *           signal?: AbortSignal, raw?: boolean }} opts
 */
export async function googleFetch(url, { method = 'POST', body, fieldMask, timeoutMs = 6_000, signal, raw }) {
  requireGoogle();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: raw ? 'manual' : 'follow',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GOOGLE_MAPS_SERVER_API_KEY,
        ...(fieldMask ? { 'x-goog-fieldmask': fieldMask } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      const g = payload?.error ?? {};
      logger.warn({ status: res.status, googleStatus: g.status, googleMessage: g.message }, 'google maps request failed');

      if (res.status === 429) {
        throw new HttpError(503, 'Google Maps is rate limiting us, try again shortly', { code: 'GOOGLE_QUOTA' });
      }
      if (res.status === 403 || res.status === 401) {
        // Bad key, API not enabled, or a key restriction that excludes this server.
        throw new HttpError(503, 'Google Maps is not authorised for this server', { code: 'GOOGLE_AUTH' });
      }
      if (res.status === 404) throw new HttpError(404, 'Place not found', { code: 'PLACE_NOT_FOUND' });
      if (res.status === 400) throw new HttpError(502, 'Google rejected the request', { code: 'GOOGLE_BAD_REQUEST' });
      throw new HttpError(502, 'Google Maps is unavailable', { code: 'GOOGLE_ERROR' });
    }
    return res.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (signal?.aborted) throw err; // the client went away; nothing to report
    if (controller.signal.aborted) {
      throw new HttpError(504, 'Google Maps took too long to answer', { code: 'GOOGLE_TIMEOUT' });
    }
    throw new HttpError(502, 'Could not reach Google Maps', { code: 'GOOGLE_UNREACHABLE', cause: err });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------------------------ cache */

const MAX_MEMORY_ENTRIES = 500;
const memory = new Map(); // key -> { expires, value }
const inflight = new Map(); // key -> { promise, controller, waiters }

const remember = (key, value, ttlMs) => {
  if (memory.size >= MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
  memory.set(key, { expires: Date.now() + ttlMs, value });
};

/**
 * Cache + in-flight de-duplication. Identical concurrent requests share one Google
 * call; that call is only aborted when *every* waiter has gone away, so one
 * visitor cancelling a pan does not break another's identical request.
 *
 * Redis is a bonus: with it, instances share the cache; if it is down (it fails
 * fast, enableOfflineQueue is off) the in-process map still works.
 *
 * @template T
 * @param {string} key
 * @param {(signal: AbortSignal) => Promise<T>} producer
 * @param {{ ttlSeconds?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<T>}
 */
export async function cached(key, producer, { ttlSeconds = env.PLACES_CACHE_TTL_SECONDS, signal } = {}) {
  if (ttlSeconds <= 0) return producer(signal ?? new AbortController().signal);

  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  try {
    const stored = await redis.get(`gmaps:${key}`);
    if (stored) {
      const value = JSON.parse(stored);
      remember(key, value, ttlSeconds * 1000);
      return value;
    }
  } catch {
    /* Redis down or unparsable — fall through to Google */
  }

  let entry = inflight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, waiters: 0 };
    entry.promise = producer(controller.signal)
      .then(async (value) => {
        remember(key, value, ttlSeconds * 1000);
        redis.set(`gmaps:${key}`, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {});
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, entry);
  }

  entry.waiters += 1;
  return new Promise((resolve, reject) => {
    const leave = () => {
      entry.waiters -= 1;
      if (entry.waiters <= 0) entry.controller.abort(new Error('all waiters left'));
      reject(signal.reason ?? new Error('aborted'));
    };
    if (signal) {
      if (signal.aborted) return leave();
      signal.addEventListener('abort', leave, { once: true });
    }
    entry.promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', leave));
  });
}

export const PLACES_API = PLACES_BASE;
export const ROUTES_API = ROUTES_BASE;

/** Test hook. */
export function _clearCache() {
  memory.clear();
  inflight.clear();
}
