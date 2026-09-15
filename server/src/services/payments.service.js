import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env, paymentsEnabled } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
import { HttpError, badRequest, conflict, notFound } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';

/*
 * Payment orchestration and verification.
 *
 * Card data never reaches this server: the browser talks to Razorpay's hosted
 * checkout, and we only ever see identifiers and a signature. That is what keeps
 * Tour Mate in PCI-DSS SAQ-A scope.
 *
 * The security model has three parts, and all three matter:
 *   1. The *amount* is decided here, from the booking row — never from the
 *      client. A browser that posts its own price gets ignored.
 *   2. The *order* is recorded against the booking before the traveller pays,
 *      so at confirm time we can prove this order belongs to this booking.
 *      Without that, a valid signature from a ₹500 booking would confirm a
 *      ₹50,000 one — the HMAC is over "order|payment" and says nothing about
 *      which booking was meant.
 *   3. The *signature* is verified with the key secret, in constant time.
 */

let client = null;

/*
 * 503 rather than 500: the server is healthy, the deployment is just not set up.
 * HttpError is what the error middleware understands — a plain Error with a
 * `status` property would be flattened into a generic 500.
 */
const paymentsDisabled = () => {
  // The env var names go to the log, not to the traveller — they are an operator
  // detail, and Checkout already tells the operator what to set.
  logger.error('Payments are disabled: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not both set');
  return new HttpError(503, 'Payments are temporarily unavailable.', {
    code: 'PAYMENTS_DISABLED',
  });
};

/**
 * The SDK is built on first use, not at import time. Constructing it eagerly in
 * a route module runs before dotenv has necessarily populated process.env, and
 * throws on a machine that simply has no gateway account yet.
 */
function gateway() {
  if (!paymentsEnabled) throw paymentsDisabled();
  if (!client) {
    client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
}

/** Razorpay works in the smallest currency unit. ₹1,234.50 -> 123450 paise. */
export function toMinorUnits(amount) {
  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees < 0) {
    throw badRequest('Booking amount is not a valid number');
  }
  // Round after multiplying: 0.1 + 0.2 style drift would otherwise send 123449.
  return Math.round(rupees * 100);
}

/**
 * Create (or re-use) the gateway order for a booking.
 *
 * Re-use matters: a traveller who closes the Razorpay window and clicks Pay
 * again should land on the same order rather than littering the dashboard with
 * abandoned ones. The INITIATED payments row is the record of that.
 */
export async function createGatewayOrder({ bookingId, userId }) {
  // Checked up front rather than only inside gateway(): the re-use path below
  // returns before ever calling it, and handing back an order id the server can
  // no longer verify (keys rotated away) would strand the traveller mid-payment.
  if (!paymentsEnabled) throw paymentsDisabled();

  const booking = await queryOne(
    `SELECT b.id, b.reference, b.status, b.total_amount, b.user_id, b.hold_id,
            b.seat_count, t.title AS tour_title,
            u.full_name, u.email, u.phone
       FROM bookings b
       JOIN tours t ON t.id = b.tour_id
       JOIN users u ON u.id = b.user_id
      WHERE b.id = $1 AND b.user_id = $2`,
    [bookingId, userId]
  );
  // Unknown id and someone else's booking are deliberately the same 404: a 403
  // would confirm the booking exists.
  if (!booking) throw notFound('Booking not found');
  if (booking.status === 'CONFIRMED') throw conflict('This booking is already paid');
  if (booking.status !== 'PENDING') {
    throw conflict(`Booking is ${booking.status.toLowerCase()} and cannot be paid for`);
  }
  if (!booking.hold_id) throw conflict('The seat hold expired — please pick your date again');

  const amount = toMinorUnits(booking.total_amount);
  if (amount <= 0) throw badRequest('Booking amount is zero — nothing to pay');

  /*
   * Prefill comes from the users row, not from the JWT: the token only carries
   * id/role/email, so `req.user.full_name` would silently be undefined. Passing a
   * real name and phone through means the traveller does not retype what we
   * already know, and Razorpay can send its own receipt.
   */
  const prefill = {
    name: booking.full_name ?? '',
    email: booking.email ?? '',
    contact: booking.phone ?? '',
  };

  const existing = await queryOne(
    `SELECT gateway_order_id, amount, status
       FROM payments
      WHERE booking_id = $1 AND gateway = 'razorpay' AND status = 'INITIATED'
      ORDER BY created_at DESC
      LIMIT 1`,
    [bookingId]
  );

  // Only re-use while the price still matches; an extended hold or a changed
  // configuration must not be paid for at yesterday's total.
  if (existing && toMinorUnits(existing.amount) === amount) {
    return {
      gateway: 'razorpay',
      orderId: existing.gateway_order_id,
      amount,
      currency: env.PAYMENT_CURRENCY,
      reference: booking.reference,
      tourTitle: booking.tour_title,
      prefill,
      reused: true,
    };
  }

  /*
   * Any INITIATED row still standing here is stale: a matching one returned above.
   * Left alone it stays live and payable at Razorpay for the old amount, and the
   * reuse lookup would keep offering a total the traveller was never shown. Retire
   * it before minting the replacement.
   */
  await query(
    `UPDATE payments
        SET status = 'FAILED',
            raw_webhook = COALESCE(raw_webhook, '{}'::jsonb)
                           || jsonb_build_object('reason', 'superseded by a newer order')
      WHERE booking_id = $1 AND gateway = 'razorpay' AND status = 'INITIATED'`,
    [bookingId]
  );

  let order;
  try {
    order = await gateway().orders.create({
      amount,
      currency: env.PAYMENT_CURRENCY,
      // Razorpay caps receipt at 40 chars and requires uniqueness per order.
      receipt: String(booking.reference).slice(0, 40),
      notes: {
        bookingId: booking.id,
        tour: String(booking.tour_title ?? '').slice(0, 60),
        seats: String(booking.seat_count),
      },
    });
  } catch (err) {
    // The SDK surfaces the gateway's own JSON under `error.description`.
    const description = err?.error?.description ?? err?.message ?? 'Gateway rejected the order';
    logger.error({ err, bookingId }, 'razorpay order creation failed');
    throw new HttpError(502, `Payment gateway error: ${description}`, { code: 'GATEWAY_ERROR' });
  }

  /*
   * Record the order *before* the traveller pays. This row is what proves, at
   * confirm time, that the order belongs to this booking.
   *
   * ON CONFLICT only guards a repeated insert of the *same* order id (a replayed
   * request); it is not a concurrency guard, because two in-flight calls each get
   * a distinct gateway order id. `orderLimiter` bounds how often that can happen.
   */
  await query(
    `INSERT INTO payments
       (booking_id, gateway, gateway_order_id, status, amount, currency)
     VALUES ($1, 'razorpay', $2, 'INITIATED', $3, $4)
     ON CONFLICT (gateway, gateway_order_id) DO UPDATE
       SET amount = EXCLUDED.amount, currency = EXCLUDED.currency`,
    [bookingId, order.id, booking.total_amount, env.PAYMENT_CURRENCY]
  );

  return {
    gateway: 'razorpay',
    orderId: order.id,
    amount,
    currency: env.PAYMENT_CURRENCY,
    reference: booking.reference,
    tourTitle: booking.tour_title,
    prefill,
    reused: false,
  };
}

/**
 * Prove this order was created for this booking, at this amount.
 *
 * A correct signature only says "Razorpay signed this order/payment pair". It
 * does not say which booking the money was for. Without this check, replaying a
 * genuine cheap-booking callback against an expensive booking would confirm it.
 *
 * The amount assertion is what keeps the ledger honest: confirmBooking records
 * the *booking's* total, not the amount that was actually ordered, so if the two
 * ever diverge (a price edit, a re-quote) the recorded capture would overstate
 * what was collected. Compare in minor units — 1234.50 in a NUMERIC(10,2) column
 * arrives as the string "1234.50", and float equality on rupees would be fragile.
 */
export async function assertOrderBelongsToBooking({ bookingId, gateway: name, orderId, userId }) {
  const row = await queryOne(
    `SELECT p.booking_id, p.amount, p.status, b.user_id, b.total_amount
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
      WHERE p.gateway = $1 AND p.gateway_order_id = $2`,
    [name, orderId]
  );
  if (!row) throw badRequest('That payment order does not belong to this booking');
  /*
   * Ownership is settled *before* the order↔booking relation is revealed, so a
   * prober cannot use the differing errors to test which booking an order belongs
   * to. Order ids are unguessable gateway ids either way; this just removes the
   * oracle rather than relying on that.
   */
  if (userId && row.user_id !== userId) throw notFound('Booking not found');
  if (row.booking_id !== bookingId) {
    throw badRequest('That payment order does not belong to this booking');
  }
  if (toMinorUnits(row.amount) !== toMinorUnits(row.total_amount)) {
    logger.error(
      { bookingId, orderId, ordered: row.amount, total: row.total_amount },
      'payment amount does not match the booking total'
    );
    throw conflict('The amount on this order no longer matches the booking — please retry');
  }
  return row;
}

/**
 * Razorpay: HMAC-SHA256 of "<order_id>|<payment_id>" with the key secret.
 * Stripe:   HMAC-SHA256 of "<timestamp>.<raw body>" — use the raw body from the
 *           webhook route, not the parsed object.
 * @returns {boolean} true only when the signature matches
 */
export function verifyGatewaySignature({ gateway: name, orderId, paymentId, signature, rawBody, timestamp }) {
  try {
    if (name === 'razorpay') {
      const secret = env.RAZORPAY_KEY_SECRET;
      if (!secret) {
        logger.error('RAZORPAY_KEY_SECRET missing — refusing to trust the signature');
        return false;
      }
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId ?? ''}`)
        .digest('hex');
      return timingSafeEqual(expected, signature);
    }

    if (name === 'stripe') {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret || !rawBody || !timestamp) return false;
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
      return timingSafeEqual(expected, signature);
    }

    return false;
  } catch (err) {
    logger.error({ err, gateway: name }, 'signature verification threw');
    return false;
  }
}

/** Mark an abandoned or failed attempt without touching the booking. */
export async function recordFailedAttempt({ bookingId, orderId, reason }) {
  if (!orderId) return;
  await query(
    `UPDATE payments
        SET status = 'FAILED',
            raw_webhook = COALESCE(raw_webhook, '{}'::jsonb) || $3::jsonb
      WHERE booking_id = $1 AND gateway_order_id = $2 AND status = 'INITIATED'`,
    [bookingId, orderId, JSON.stringify({ reason: String(reason ?? 'unknown').slice(0, 300) })]
  ).catch((err) => logger.error({ err, bookingId }, 'could not record failed attempt'));
}

/** Constant-time compare that tolerates length mismatch. */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
