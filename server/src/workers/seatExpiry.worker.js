import { setTimeout as delay } from 'node:timers/promises';
import { expireStalePending } from '../services/booking.service.js';
import { logger } from '../utils/logger.js';

/*
 * Two ledgers hold seats, so two things must be swept.
 *
 * 1. Redis expires the hold key on its own (TTL), and the acquire Lua script
 *    drops orphaned hash fields before counting — inventory is therefore correct
 *    the moment a hold lapses, with no worker involved.
 * 2. The PENDING bookings row that pointed at that hold is still sitting in
 *    Postgres. It reserves nothing, but it clutters "my bookings" and the admin
 *    checkout tile, so this sweeper flips it to CANCELLED once expires_at passes.
 *
 * Keeping the sweeper off the request path is deliberate: a slow sweep must never
 * delay a checkout, and a crashed sweeper must never oversell a date.
 */

const DEFAULT_INTERVAL_MS = 60_000;

export function startSeatExpiryWorker({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let stopped = false;

  async function tick() {
    try {
      // The service logs the count when there is one.
      await expireStalePending();
    } catch (err) {
      // Never let a sweep failure take the process down — next tick retries.
      logger.error({ err }, 'seat expiry sweep failed');
    }
  }

  const loop = (async () => {
    // Small stagger so several API instances do not sweep in lockstep.
    await delay(Math.floor(Math.random() * 5_000));
    while (!stopped) {
      await tick();
      await delay(intervalMs);
    }
  })();

  logger.info({ intervalMs }, 'seat expiry worker started');

  return {
    async stop() {
      stopped = true;
      await loop.catch(() => {});
    },
  };
}
