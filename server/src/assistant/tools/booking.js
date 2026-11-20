import { istDate, addDays } from '../intent.js';

/*
 * Booking tools — READ-ONLY in Phase 2a (as in Phase 1).
 *
 * Nothing here holds seats, starts checkout, touches Razorpay or writes a
 * booking. Those stay behind the existing authenticated /bookings routes.
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
      async run(ctx, { seatCount, dateRange } = {}) {
        if (!ctx.tourId) return { data: { needsTour: true } };
        if (!seatCount) return { data: { needsSeatCount: true } };

        const today = istDate(new Date());
        const from = today;
        const to = dateRange?.from && dateRange.from > addDays(today, QUOTE_WINDOW_DAYS)
          ? dateRange.from
          : addDays(today, QUOTE_WINDOW_DAYS);

        const [calendar, tourRow] = await Promise.all([
          deps.booking.getCalendar({ tourId: ctx.tourId, from, to }),
          deps.db.queryOne('SELECT slug, options FROM tours WHERE id = $1 AND is_published', [ctx.tourId]),
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
            seatCount,
            date: slot?.date ?? null,
            totalAmount: q.totalAmount,
            breakdown: q.breakdown,
          },
          sources: [{ kind: 'quote', ref: 'computed' }],
          ui: [
            {
              type: 'quote',
              tourId: ctx.tourId,
              slug: tourRow?.slug ?? null,
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
        };
      },
    },
  ];
}
