import { istDate, addDays } from '../dates.js';

/*
 * Booking tools — READ-ONLY (Phases 1, 2a and 2b).
 *
 * Nothing here holds seats, starts checkout, touches Razorpay or writes a
 * booking. Those stay behind the existing authenticated /bookings routes.
 * In Phase 2b the TRAVELLER places a hold by pressing a button in the browser,
 * which calls POST /bookings/checkout directly. The model never can: a hold
 * burns inventory for 10 minutes, so it needs a human click, not a tool call.
 * test/assistant.noWrites.test.js enforces this.
 *   - price_quote    : same pure computation as the public POST /bookings/quote.
 *                      Also returns a `quote` UI block (date chips + options
 *                      catalog) so the browser can let the traveller adjust the
 *                      price through the existing public quote endpoint.
 *   - checkout_state : the signed-in user's own booking only; ownership is
 *                      enforced inside booking.getCheckoutState (403 otherwise).
 */

const QUOTE_WINDOW_DAYS = 45;

export function bookingTools(deps) {
  return [
    {
      name: 'price_quote',
      group: 'booking',
      async run(ctx, { seatCount: askedSeats, dateRange, dateProblem } = {}) {
        if (!ctx.tourId) return { data: { needsTour: true } };
        if (dateProblem) return { data: { dateProblem } };

        // "this weekend" is two days. A price belongs to ONE departure, so ask which.
        if (dateRange && dateRange.from !== dateRange.to) {
          return { data: { needsDay: [dateRange.from, dateRange.to] } };
        }

        // Nobody said how many: price one seat and let them change it on the card,
        // which is quicker than another round of questions.
        const seatCount = askedSeats ?? 1;
        const seatCountAssumed = !askedSeats;

        const today = istDate(new Date());
        const from = today;
        const to = dateRange?.from && dateRange.from > addDays(today, QUOTE_WINDOW_DAYS)
          ? dateRange.from
          : addDays(today, QUOTE_WINDOW_DAYS);

        const [calendar, tourRow] = await Promise.all([
          deps.booking.getCalendar({ tourId: ctx.tourId, from, to }),
          deps.db.queryOne('SELECT slug, title, options FROM tours WHERE id = $1 AND is_published', [ctx.tourId]),
        ]);
        const open = calendar.filter((d) => d.isOpen && d.date >= today);

        let slot;
        if (dateRange?.from) {
          slot = open.find((d) => d.date === dateRange.from);
          if (!slot) return { data: { noDeparture: dateRange.from } };
        }

        const q = await deps.booking.quote({ tourId: ctx.tourId, slotId: slot?.slotId, seatCount });
        return {
          data: {
            tour: tourRow?.title ?? null,
            seatCount,
            seatCountAssumed,
            date: slot?.date ?? null,
            // No date chosen yet: this is the standard price; a date can add a surcharge.
            dateAssumed: !slot,
            totalAmount: q.totalAmount,
            breakdown: q.breakdown,
          },
          sources: [{ kind: 'quote', ref: 'computed' }],
          ui: [
            {
              type: 'quote',
              tourId: ctx.tourId,
              slug: tourRow?.slug ?? null,
              tourTitle: tourRow?.title ?? null,
              seatCount,
              slotId: slot?.slotId ?? null,
              date: slot?.date ?? null,
              totalAmount: q.totalAmount,
              lines: q.breakdown.lines,
              options: tourRow?.options ?? {},
              dates: open.slice(0, 10).map((d) => ({
                slotId: d.slotId,
                date: d.date,
                seatsLeft: d.availableSeats,
                extraPerSeat: Number(d.priceModifier) || 0,
              })),
            },
          ],
        };
      },
    },
    {
      name: 'checkout_state',
      group: 'booking',
      async run(ctx, { bookingId } = {}) {
        if (!ctx.user) return { data: { requiresAuth: true } };
        if (!bookingId) return { data: { needsBookingId: true } };

        const { booking, secondsLeft, holdActive } = await deps.booking.getCheckoutState({
          bookingId,
          userId: ctx.user.id,
        });
        return {
          data: {
            reference: booking.reference,
            tour: booking.tour_title,
            status: booking.status,
            seats: booking.seat_count,
            totalAmount: booking.total_amount,
            holdActive,
            secondsLeft,
          },
          sources: [{ kind: 'booking', ref: booking.reference }],
          // Owner-only by construction: getCheckoutState already refused anyone else.
          // The card links to the existing /checkout page; it never acts by itself.
          ui: [
            {
              type: 'checkout_state',
              bookingId: booking.id,
              reference: booking.reference,
              tour: booking.tour_title,
              status: booking.status,
              seats: booking.seat_count,
              totalAmount: booking.total_amount,
              holdActive,
              secondsLeft,
            },
          ],
        };
      },
    },
  ];
}
