import { randomBytes } from 'node:crypto';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { computeQuote } from './pricing.service.js';
import {
  acquireHold,
  releaseHold,
  holdTtl,
  getAvailability,
  getSlotCapacity,
  getHeldSeats,
} from './seatLock.service.js';
import { conflict, notFound, forbidden, badRequest } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';

const reference = () => `TM-${randomBytes(4).toString('hex').toUpperCase()}`;

/** Calendar for a month: seats left per date, holds included. */
export async function getCalendar({ tourId, from, to }) {
  const { rows } = await query(
    `SELECT s.id            AS slot_id,
            s.slot_date::text AS date,
            s.total_seats,
            s.price_modifier,
            s.is_open,
            s.guide_id IS NOT NULL AS has_guide,
            COALESCE(SUM(b.seat_count) FILTER (WHERE b.status = 'CONFIRMED'), 0)::int
              AS confirmed_seats
       FROM tour_slots s
       LEFT JOIN bookings b ON b.slot_id = s.id
      WHERE s.tour_id = $1
        AND s.slot_date BETWEEN $2::date AND $3::date
      GROUP BY s.id
      ORDER BY s.slot_date`,
    [tourId, from, to]
  );

  // Redis holds for each date; getHeldSeats pipelines its own EXISTS checks.
  const held = await Promise.all(rows.map((r) => getHeldSeats(tourId, r.date)));

  return rows.map((r, i) => ({
    slotId: r.slot_id,
    date: r.date,
    totalSeats: r.total_seats,
    availableSeats: Math.max(r.total_seats - r.confirmed_seats - held[i], 0),
    heldSeats: held[i],
    priceModifier: r.price_modifier,
    hasGuide: r.has_guide,
    isOpen: r.is_open,
  }));
}

/** Live quote for the configurator. No auth, no side effects. */
export async function quote({ tourId, slotId, seatCount, selectedOptions }) {
  const tour = await queryOne(
    'SELECT id, base_price, options FROM tours WHERE id = $1 AND is_published',
    [tourId]
  );
  if (!tour) throw notFound('Tour not found');

  let priceModifier = 0;
  if (slotId) {
    const slot = await getSlotCapacity(slotId);
    if (slot.tour_id !== tourId) throw badRequest('That date belongs to a different tour');
    priceModifier = slot.price_modifier;
  }
  return computeQuote({ tour, selectedOptions, seatCount, priceModifier });
}

/**
 * Step 1 of checkout — reserve seats for 10 minutes. Requires login: this is the
 * payment boundary the requirements call out.
 */
export async function startCheckout({ userId, slotId, seatCount, selectedOptions }) {
  const slot = await getSlotCapacity(slotId);
  const tour = await queryOne(
    'SELECT id, title, base_price, options FROM tours WHERE id = $1 AND is_published',
    [slot.tour_id]
  );
  if (!tour) throw notFound('Tour not found');

  // Price before holding, so a bad configuration never burns inventory.
  const { totalAmount, breakdown } = computeQuote({
    tour,
    selectedOptions,
    seatCount,
    priceModifier: slot.price_modifier,
  });

  const hold = await acquireHold({ slotId, seatCount, userId });

  try {
    const booking = await queryOne(
      `INSERT INTO bookings
         (reference, user_id, tour_id, slot_id, booking_date, seat_count,
          total_amount, price_breakdown, selected_options, status, hold_id, expires_at)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8::jsonb, $9::jsonb, 'PENDING', $10, $11)
       RETURNING id, reference, status, total_amount, expires_at`,
      [
        reference(),
        userId,
        tour.id,
        slotId,
        slot.slot_date,
        seatCount,
        totalAmount,
        JSON.stringify(breakdown),
        JSON.stringify(selectedOptions ?? {}),
        hold.holdId,
        hold.expiresAt,
      ]
    );

    return { booking, hold, breakdown, tourTitle: tour.title };
  } catch (err) {
    // Never leave seats held for a booking row that failed to insert.
    await releaseHold(hold.holdId).catch(() => {});
    throw err;
  }
}

/** Countdown for the checkout page. */
export async function getCheckoutState({ bookingId, userId }) {
  const booking = await queryOne(
    `SELECT b.*, t.title AS tour_title
       FROM bookings b JOIN tours t ON t.id = b.tour_id
      WHERE b.id = $1`,
    [bookingId]
  );
  if (!booking) throw notFound('Booking not found');
  if (booking.user_id !== userId) throw forbidden();

  const secondsLeft = booking.hold_id ? await holdTtl(booking.hold_id) : 0;
  return { booking, secondsLeft, holdActive: secondsLeft > 0 };
}

/**
 * Step 2 — payment succeeded. Re-checks capacity against CONFIRMED rows under a
 * row lock, then flips the booking and drops the Redis hold.
 */
export async function confirmBooking({ bookingId, userId, payment }) {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT b.*, s.total_seats
         FROM bookings b
         JOIN tour_slots s ON s.id = b.slot_id
        WHERE b.id = $1
        FOR UPDATE OF b`,
      [bookingId]
    );
    const booking = rows[0];
    if (!booking) throw notFound('Booking not found');
    if (userId && booking.user_id !== userId) throw forbidden();
    if (booking.status === 'CONFIRMED') return { booking, alreadyConfirmed: true };
    if (booking.status !== 'PENDING') {
      throw conflict(`Booking is ${booking.status.toLowerCase()} and cannot be confirmed`);
    }

    // Belt and braces: the Redis hold should already guarantee this.
    const { rows: seatRows } = await client.query(
      `SELECT COALESCE(SUM(seat_count), 0)::int AS confirmed
         FROM bookings
        WHERE slot_id = $1 AND status = 'CONFIRMED'`,
      [booking.slot_id]
    );
    if (seatRows[0].confirmed + booking.seat_count > booking.total_seats) {
      throw conflict('Seats were taken while payment was processing — refund required', {
        refundRequired: true,
      });
    }

    const { rows: updated } = await client.query(
      `UPDATE bookings
          SET status = 'CONFIRMED', expires_at = NULL, hold_id = NULL
        WHERE id = $1
        RETURNING id, reference, status, total_amount, booking_date::text AS booking_date`,
      [bookingId]
    );

    if (payment) {
      await client.query(
        `INSERT INTO payments
           (booking_id, gateway, gateway_order_id, gateway_payment_id,
            status, amount, signature_verified, raw_webhook)
         VALUES ($1, $2, $3, $4, 'CAPTURED', $5, $6, $7::jsonb)
         ON CONFLICT (gateway, gateway_order_id) DO UPDATE
           SET status = 'CAPTURED',
               gateway_payment_id = EXCLUDED.gateway_payment_id,
               signature_verified = EXCLUDED.signature_verified`,
        [
          bookingId,
          payment.gateway,
          payment.orderId,
          payment.paymentId ?? null,
          booking.total_amount,
          payment.signatureVerified === true,
          JSON.stringify(payment.raw ?? {}),
        ]
      );
    }

    return { booking: updated[0], holdId: booking.hold_id, alreadyConfirmed: false };
  });

  // Outside the transaction: Redis failure must not roll back a paid booking.
  if (result.holdId) {
    await releaseHold(result.holdId).catch((err) =>
      logger.error({ err, holdId: result.holdId }, 'hold release failed after confirm')
    );
  }
  return result;
}

/** Traveller-initiated cancel. Refund amount comes from tours.refund_policy. */
export async function cancelBooking({ bookingId, userId }) {
  const booking = await queryOne(
    `UPDATE bookings b
        SET status = 'CANCELLED', cancelled_at = NOW(), hold_id = NULL
      WHERE b.id = $1
        AND b.user_id = $2
        AND b.status IN ('PENDING', 'CONFIRMED')
      RETURNING b.id, b.reference, b.status, b.hold_id, b.total_amount,
                b.booking_date::text AS booking_date, b.tour_id`,
    [bookingId, userId]
  );
  if (!booking) throw conflict('Booking cannot be cancelled');

  const policy = await queryOne('SELECT refund_policy FROM tours WHERE id = $1', [
    booking.tour_id,
  ]);
  const daysBefore = Math.floor(
    (new Date(booking.booking_date) - Date.now()) / 86_400_000
  );
  const tier = (policy?.refund_policy ?? [])
    .filter((p) => daysBefore >= p.daysBefore)
    .sort((a, b) => b.daysBefore - a.daysBefore)[0];
  const refundPercent = tier?.refundPercent ?? 0;

  return {
    booking,
    refundPercent,
    refundAmount: ((Number(booking.total_amount) * refundPercent) / 100).toFixed(2),
  };
}

/**
 * Sweeper for PENDING rows whose hold has lapsed. Seats are already free (the
 * Redis TTL did that); this only makes the database agree.
 */
export async function expireStalePending() {
  const { rows } = await query(
    `UPDATE bookings
        SET status = 'EXPIRED', hold_id = NULL
      WHERE status = 'PENDING'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
      RETURNING id`
  );
  if (rows.length) logger.info({ count: rows.length }, 'expired stale pending bookings');
  return rows.length;
}

export { getAvailability };
