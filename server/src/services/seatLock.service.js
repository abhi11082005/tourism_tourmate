import { randomUUID } from 'node:crypto';
import { redis } from '../db/redis.js';
import { queryOne } from '../db/pool.js';
import { env } from '../config/env.js';
import { conflict, notFound, gone } from '../utils/httpError.js';

/*
 * Seat inventory has two ledgers and one rule.
 *
 *   Postgres  = durable truth for CONFIRMED seats.
 *   Redis     = short-lived truth for seats being checked out (10 min TTL).
 *
 *   available = slot.total_seats - confirmed(Postgres) - held(Redis)
 *
 * A PENDING booking row does NOT reserve capacity on its own; its Redis hold
 * does. So an abandoned checkout frees seats the moment the TTL lapses, with no
 * background job in the critical path, and a Redis flush can never "lose" a paid
 * seat. The sweeper only tidies up the PENDING rows afterwards.
 */

const holdHashKey = (tourId, date) => `seats:hold:${tourId}:${date}`;
const HOLD_TTL_PREFIX = 'seats:hold:ttl:';

/** Confirmed seats + capacity for a slot, straight from Postgres. */
export async function getSlotCapacity(slotId) {
  const row = await queryOne(
    `SELECT s.id,
            s.tour_id,
            s.slot_date::text                      AS slot_date,
            s.total_seats,
            s.price_modifier,
            s.is_open,
            s.guide_id,
            COALESCE(SUM(b.seat_count) FILTER (WHERE b.status = 'CONFIRMED'), 0)::int
              AS confirmed_seats
       FROM tour_slots s
       LEFT JOIN bookings b ON b.slot_id = s.id
      WHERE s.id = $1
      GROUP BY s.id`,
    [slotId]
  );
  if (!row) throw notFound('That departure date is not available');
  return row;
}

/** Seats currently held in Redis for a slot, ignoring lapsed holds. */
export async function getHeldSeats(tourId, slotDate) {
  const hash = await redis.hgetall(holdHashKey(tourId, slotDate));
  const ids = Object.keys(hash);
  if (ids.length === 0) return 0;

  // Pipeline the EXISTS checks: one round trip regardless of hold count.
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.exists(`${HOLD_TTL_PREFIX}${id}`);
  const results = await pipeline.exec();

  let held = 0;
  ids.forEach((id, i) => {
    const [, alive] = results[i];
    if (alive === 1) held += Number(hash[id]) || 0;
  });
  return held;
}

/** available = total - confirmed - held. Never negative. */
export async function getAvailability(slotId) {
  const slot = await getSlotCapacity(slotId);
  const held = await getHeldSeats(slot.tour_id, slot.slot_date);
  const available = Math.max(slot.total_seats - slot.confirmed_seats - held, 0);
  return { ...slot, held_seats: held, available_seats: available };
}

/**
 * Atomically reserve `seatCount` seats for 10 minutes.
 * The capacity check and the write happen inside one Lua script, so two users
 * racing for the last seat cannot both win.
 */
export async function acquireHold({ slotId, seatCount, userId }) {
  const slot = await getSlotCapacity(slotId);
  if (!slot.is_open) throw conflict('This departure is closed for booking');

  const holdId = randomUUID();
  const payload = JSON.stringify({
    holdId,
    slotId,
    tourId: slot.tour_id,
    slotDate: slot.slot_date,
    seatCount,
    userId,
  });

  const [ok, remaining] = await redis.acquireSeatHold(
    holdHashKey(slot.tour_id, slot.slot_date),
    holdId,
    String(seatCount),
    String(slot.total_seats),
    String(slot.confirmed_seats),
    String(env.SEAT_HOLD_TTL_SECONDS),
    HOLD_TTL_PREFIX,
    payload
  );

  if (ok !== 1) {
    throw conflict(
      remaining > 0
        ? `Only ${remaining} seat(s) left on this date`
        : 'This date just sold out',
      { availableSeats: Math.max(remaining, 0) }
    );
  }

  return {
    holdId,
    slotId,
    tourId: slot.tour_id,
    slotDate: slot.slot_date,
    seatCount,
    expiresAt: new Date(Date.now() + env.SEAT_HOLD_TTL_SECONDS * 1000).toISOString(),
    remainingSeats: remaining,
  };
}

/** Read a hold, or throw 410 once its TTL has lapsed. */
export async function readHold(holdId) {
  const raw = await redis.get(`${HOLD_TTL_PREFIX}${holdId}`);
  if (!raw) throw gone('Your seat hold expired — please pick your seats again');
  return JSON.parse(raw);
}

/** Seconds left on a hold; 0 when gone. Drives the checkout countdown. */
export async function holdTtl(holdId) {
  const ttl = await redis.ttl(`${HOLD_TTL_PREFIX}${holdId}`);
  return ttl > 0 ? ttl : 0;
}

/** Idempotent release — used on payment success, cancel, and by the sweeper. */
export async function releaseHold(holdId) {
  const raw = await redis.get(`${HOLD_TTL_PREFIX}${holdId}`);
  if (!raw) return false;
  const { tourId, slotDate } = JSON.parse(raw);
  await redis.releaseSeatHold(
    holdHashKey(tourId, slotDate),
    `${HOLD_TTL_PREFIX}${holdId}`,
    holdId
  );
  return true;
}

/** Give the traveller more time without letting them camp on seats forever. */
export async function extendHold(holdId, seconds = 120) {
  const key = `${HOLD_TTL_PREFIX}${holdId}`;
  const ttl = await redis.ttl(key);
  if (ttl <= 0) throw gone('Your seat hold expired');
  const capped = Math.min(ttl + seconds, env.SEAT_HOLD_TTL_SECONDS * 2);
  await redis.expire(key, capped);
  return capped;
}
