/*
 * Booking tools — READ-ONLY in Phase 1.
 *
 * Nothing here holds seats, starts checkout, touches Razorpay or writes a
 * booking. Those stay behind the existing authenticated /bookings routes.
 *   - price_quote    : same pure computation as the public POST /bookings/quote.
 *   - checkout_state : the signed-in user's own booking only; ownership is
 *                      enforced inside booking.getCheckoutState (403 otherwise).
 */

export function bookingTools(deps) {
  return [
    {
      name: 'price_quote',
      group: 'booking',
      async run(ctx, { seatCount, dateRange } = {}) {
        if (!ctx.tourId) return { data: { needsTour: true } };
        if (!seatCount) return { data: { needsSeatCount: true } };

        let slotId;
        if (dateRange?.from) {
          const day = await deps.booking.getCalendar({
            tourId: ctx.tourId,
            from: dateRange.from,
            to: dateRange.from,
          });
          const slot = day.find((d) => d.isOpen);
          if (!slot) return { data: { noDeparture: dateRange.from } };
          slotId = slot.slotId;
        }

        const q = await deps.booking.quote({ tourId: ctx.tourId, slotId, seatCount });
        return {
          data: {
            seatCount,
            date: dateRange?.from ?? null,
            totalAmount: q.totalAmount,
            breakdown: q.breakdown,
          },
          sources: [{ kind: 'quote', ref: 'computed' }],
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
