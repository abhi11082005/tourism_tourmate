import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler, validate } from '../middleware/index.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import * as booking from '../services/booking.service.js';
import * as documents from '../services/documents.service.js';
import { getAvailability, extendHold, releaseHold } from '../services/seatLock.service.js';
import {
  assertOrderBelongsToBooking,
  createGatewayOrder,
  recordFailedAttempt,
  toMinorUnits,
  verifyGatewaySignature,
} from '../services/payments.service.js';
import { env, paymentsEnabled } from '../config/env.js';
import { query } from '../db/pool.js';

export const bookingRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuid = z.string().uuid();

// Holding seats is a write to shared inventory: cap it per IP.
const holdLimiter = rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: 'draft-7' });

// Order creation hits Razorpay's API, so it gets its own, tighter budget. The
// happy path needs one call per checkout; anything more is a retry or a bot.
const orderLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7' });

// ---------------------------------------------------------------- browsing
// Calendar and quotes stay open to guests so the configurator works before login.
bookingRouter.get(
  '/calendar/:tourId',
  optionalAuth,
  validate('params', z.object({ tourId: uuid })),
  validate('query', z.object({ from: isoDate, to: isoDate })),
  asyncHandler(async (req, res) => {
    res.set('cache-control', 'no-store'); // seat counts must never be cached
    res.json({
      dates: await booking.getCalendar({
        tourId: req.params.tourId,
        from: req.query.from,
        to: req.query.to,
      }),
    });
  })
);

bookingRouter.get(
  '/availability/:slotId',
  validate('params', z.object({ slotId: uuid })),
  asyncHandler(async (req, res) => {
    const slot = await getAvailability(req.params.slotId);
    res.set('cache-control', 'no-store');
    res.json({
      slotId: slot.id,
      date: slot.slot_date,
      totalSeats: slot.total_seats,
      availableSeats: slot.available_seats,
      heldSeats: slot.held_seats,
      isOpen: slot.is_open,
    });
  })
);

bookingRouter.post(
  '/quote',
  optionalAuth,
  validate(
    'body',
    z.object({
      tourId: uuid,
      slotId: uuid.optional(),
      seatCount: z.number().int().min(1).max(20),
      selectedOptions: z.record(z.union([z.boolean(), z.string()])).default({}),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json(await booking.quote(req.body));
  })
);

// ---------------------------------------------------------------- checkout


// Everything below requires a signed-in user: this is the payment boundary.
bookingRouter.post(
  '/checkout',
  requireAuth,
  holdLimiter,
  validate(
    'body',
    z.object({
      slotId: uuid,
      seatCount: z.number().int().min(1).max(20),
      selectedOptions: z.record(z.union([z.boolean(), z.string()])).default({}),
    })
  ),
  asyncHandler(async (req, res) => {
    const result = await booking.startCheckout({ userId: req.user.id, ...req.body });
    res.status(201).json({
      bookingId: result.booking.id,
      reference: result.booking.reference,
      totalAmount: result.booking.total_amount,
      breakdown: result.breakdown,
      holdId: result.hold.holdId,
      holdExpiresAt: result.hold.expiresAt,
      seatsRemaining: result.hold.remainingSeats,
    });
  })
);

bookingRouter.get(
  '/:bookingId/state',
  requireAuth,
  validate('params', z.object({ bookingId: uuid })),
  asyncHandler(async (req, res) => {
    const state = await booking.getCheckoutState({
      bookingId: req.params.bookingId,
      userId: req.user.id,
    });
    res.set('cache-control', 'no-store');
    res.json({
      status: state.booking.status,
      reference: state.booking.reference,
      totalAmount: state.booking.total_amount,
      breakdown: state.booking.price_breakdown,
      secondsLeft: state.secondsLeft,
      holdActive: state.holdActive,
      // Lets Checkout say "payments aren't set up" up front rather than letting
      // the traveller click Pay and hit a 503. A boolean only — never the keys.
      paymentsEnabled,
    });
  })
);

bookingRouter.post(
  '/:bookingId/extend',
  requireAuth,
  validate('params', z.object({ bookingId: uuid })),
  asyncHandler(async (req, res) => {
    const state = await booking.getCheckoutState({
      bookingId: req.params.bookingId,
      userId: req.user.id,
    });
    const seconds = await extendHold(state.booking.hold_id);
    await query('UPDATE bookings SET expires_at = NOW() + ($2 || \' seconds\')::interval WHERE id = $1', [
      req.params.bookingId,
      String(seconds),
    ]);
    res.json({ secondsLeft: seconds });
  })
);

bookingRouter.post(
  '/:bookingId/abandon',
  requireAuth,
  validate('params', z.object({ bookingId: uuid })),
  asyncHandler(async (req, res) => {
    const state = await booking.getCheckoutState({
      bookingId: req.params.bookingId,
      userId: req.user.id,
    });
    if (state.booking.hold_id) await releaseHold(state.booking.hold_id);
    await query(
      `UPDATE bookings SET status = 'CANCELLED', cancelled_at = NOW(), hold_id = NULL
        WHERE id = $1 AND status = 'PENDING'`,
      [req.params.bookingId]
    );
    res.json({ released: true });
  })
);

// ------------------------------------------------------------ post-payment

/*
 * Open the gateway. The browser gets an order id and the *publishable* key id —
 * never the secret, which only ever signs and verifies on this side.
 *
 * The amount is computed here from the booking row. A client that posts its own
 * price is ignored, which is the whole reason this endpoint exists rather than
 * letting the browser call Razorpay directly.
 */
bookingRouter.post(
  '/:bookingId/order',
  requireAuth,
  orderLimiter,
  validate('params', z.object({ bookingId: uuid })),
  asyncHandler(async (req, res) => {
    const order = await createGatewayOrder({
      bookingId: req.params.bookingId,
      userId: req.user.id,
    });
    res.set('cache-control', 'no-store');
    res.json({
      // The gateway name comes from the service so the client never hardcodes it.
      gateway: order.gateway,
      keyId: env.RAZORPAY_KEY_ID,
      orderId: order.orderId,
      amount: order.amount, // paise, already gateway-ready
      currency: order.currency,
      reference: order.reference,
      tourTitle: order.tourTitle,
      // Name and phone come from the users row via the service — the JWT only
      // carries id, role and email, so reading them off req.user would be blank.
      prefill: order.prefill,
    });
  })
);

/*
 * Record an abandoned or failed attempt. Fire-and-forget from the client: it
 * keeps the payments ledger honest without blocking the traveller's next try.
 */
bookingRouter.post(
  '/:bookingId/payment-failed',
  requireAuth,
  validate('params', z.object({ bookingId: uuid })),
  validate(
    'body',
    z.object({
      orderId: z.string().min(4).max(120),
      reason: z.string().max(300).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    // Ownership first, then prove the order was created for this booking. Without
    // both, anyone could mark anyone's payment failed by guessing a booking id.
    // getCheckoutState answers 403 (not 404) for someone else's booking — see the
    // 404 note in payments.service.js for why the other path differs.
    await booking.getCheckoutState({ bookingId: req.params.bookingId, userId: req.user.id });
    await assertOrderBelongsToBooking({
      bookingId: req.params.bookingId,
      gateway: 'razorpay',
      orderId: req.body.orderId,
    });
    await recordFailedAttempt({
      bookingId: req.params.bookingId,
      orderId: req.body.orderId,
      reason: req.body.reason,
    });
    res.json({ recorded: true });
  })
);

bookingRouter.post(
  '/:bookingId/confirm',
  requireAuth,
  validate('params', z.object({ bookingId: uuid })),
  validate(
    'body',
    z.object({
      // Only the gateway that is actually wired. A 'stripe' value would have no
      // verification path (no raw body or timestamp is passed here) and could
      // only ever fail, so accepting it would just be a misleading enum member.
      gateway: z.enum(['razorpay']),
      orderId: z.string().min(4).max(120),
      paymentId: z.string().min(4).max(120).optional(),
      signature: z.string().min(8).max(512),
    })
  ),
  asyncHandler(async (req, res) => {
    /*
     * Two independent checks, and both are required.
     *
     * The signature proves Razorpay signed this order/payment pair. It says
     * nothing about *which booking* the money was for — the HMAC covers only
     * "order|payment". So we also prove the order was created for this booking,
     * otherwise a genuine callback from a cheap booking could be replayed to
     * confirm an expensive one.
     *
     * userId is passed so ownership is proven by the same query, before the
     * order↔booking relation is revealed.
     */
    const record = await assertOrderBelongsToBooking({
      bookingId: req.params.bookingId,
      gateway: req.body.gateway,
      orderId: req.body.orderId,
      userId: req.user.id,
    });

    const signatureVerified = verifyGatewaySignature(req.body);
    if (!signatureVerified) {
      await recordFailedAttempt({
        bookingId: req.params.bookingId,
        orderId: req.body.orderId,
        reason: 'signature mismatch',
      });
      return res.status(400).json({
        error: { code: 'SIGNATURE_INVALID', message: 'Payment could not be verified' },
      });
    }

    /*
     * Built explicitly rather than spreading req.body: the signature is a bearer
     * proof for this order/payment pair and has no audit value once verified, so
     * there is no reason to persist it.
     */
    const result = await booking.confirmBooking({
      bookingId: req.params.bookingId,
      userId: req.user.id,
      payment: {
        gateway: req.body.gateway,
        orderId: req.body.orderId,
        paymentId: req.body.paymentId,
        signatureVerified,
        raw: {
          gateway: req.body.gateway,
          paymentId: req.body.paymentId,
          orderAmount: toMinorUnits(record.amount),
        },
      },
    });
    res.json({ booking: result.booking, alreadyConfirmed: result.alreadyConfirmed });
  })
);

bookingRouter.post(
  '/:bookingId/cancel',
  requireAuth,
  validate('params', z.object({ bookingId: uuid })),
  asyncHandler(async (req, res) => {
    res.json(
      await booking.cancelBooking({ bookingId: req.params.bookingId, userId: req.user.id })
    );
  })
);

/*
 * My trips. camelCase like every other endpoint the dashboard reads — the one
 * snake_case response left in the API was exactly the kind of thing that had
 * Layout.jsx rendering `undefined`.
 *
 * Upcoming departures come first (soonest first), then past ones newest first,
 * which is the order the Trips module renders without re-sorting.
 */
bookingRouter.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      // slot_id travels with the row so the client can open Guided Tour Mode
      // (GET /routing/guided/:slotId) without a second round trip.
      `SELECT b.id, b.reference, b.status, b.seat_count, b.total_amount, b.slot_id,
              b.booking_date::text AS booking_date, b.created_at, b.expires_at, b.cancelled_at,
              t.title AS tour_title, t.slug AS tour_slug,
              t.gallery -> 0 ->> 'url' AS cover_image,
              p.status AS payment_status, p.refund_amount, p.refunded_at
         FROM bookings b
         JOIN tours t ON t.id = b.tour_id
         LEFT JOIN LATERAL (
           SELECT pay.status, pay.refund_amount, pay.refunded_at
             FROM payments pay
            WHERE pay.booking_id = b.id
            ORDER BY (pay.status = 'CAPTURED') DESC, pay.created_at DESC
            LIMIT 1
         ) p ON TRUE
        WHERE b.user_id = $1
        ORDER BY (b.booking_date >= CURRENT_DATE) DESC,
                 CASE WHEN b.booking_date >= CURRENT_DATE THEN b.booking_date END ASC,
                 b.booking_date DESC
        LIMIT 50`,
      [req.user.id]
    );

    res.json({
      items: rows.map((b) => ({
        id: b.id,
        reference: b.reference,
        status: b.status,
        seatCount: b.seat_count,
        totalAmount: b.total_amount,
        slotId: b.slot_id,
        bookingDate: b.booking_date,
        createdAt: b.created_at,
        expiresAt: b.expires_at,
        cancelledAt: b.cancelled_at,
        tourTitle: b.tour_title,
        tourSlug: b.tour_slug,
        coverImage: b.cover_image,
        paymentStatus: b.payment_status,
        refund: b.refund_amount == null ? null : { amount: b.refund_amount, at: b.refunded_at },
      })),
    });
  })
);

/*
 * Ticket and invoice PDFs. Both are generated per request and streamed, so the
 * load-and-authorise step happens before a single byte of PDF is written —
 * afterwards the 200 is already on the wire and an error could not be reported.
 *
 * `.pdf` is part of the path so a browser "Save as" gets the extension right
 * even when Content-Disposition is stripped by a proxy.
 */
const documentRoute = (path, kind) =>
  bookingRouter.get(
    path,
    requireAuth,
    validate('params', z.object({ bookingId: uuid })),
    asyncHandler(async (req, res) => {
      const record = await documents.loadBookingDocument({
        bookingId: req.params.bookingId,
        userId: req.user.id,
        isStaff: req.user.role === 'ADMIN',
      });
      documents.assertDocumentAllowed(record, kind);

      res.set({
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${documents.documentFilename(record, kind)}"`,
        'cache-control': 'private, no-store',
      });
      documents.streamBookingDocument({ booking: record, kind, stream: res });
    })
  );

documentRoute('/:bookingId/ticket.pdf', 'TICKET');
documentRoute('/:bookingId/invoice.pdf', 'INVOICE');
