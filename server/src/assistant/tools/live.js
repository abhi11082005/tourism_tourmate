import { istDate, addDays } from '../dates.js';

/*
 * Live tools: facts that go stale the moment inventory moves, so they are read
 * from Postgres/Redis at answer time (via the existing booking/offers services)
 * and never from embeddings. Seats = total - confirmed - Redis holds.
 */

export function liveTools(deps) {
  return [
    {
      name: 'seat_availability',
      group: 'live',
      async run(ctx, { dateRange, seatCount, dateProblem } = {}) {
        if (!ctx.tourId) return { data: { needsTour: true } };
        // The traveller named a date that does not exist or has passed: say so, do not
        // quietly show other days as if they had asked for those.
        if (dateProblem) return { data: { dateProblem } };

        const today = istDate(new Date());
        const from = dateRange?.from ?? today;
        const to = dateRange?.to ?? addDays(from, 30);

        const calendar = await deps.booking.getCalendar({ tourId: ctx.tourId, from, to });
        const open = calendar.filter((d) => d.isOpen && d.date >= today);

        const dates = open.slice(0, 10).map((d) => ({
          date: d.date,
          seatsLeft: d.availableSeats,
          soldOut: d.availableSeats < 1,
          fitsParty: seatCount ? d.availableSeats >= seatCount : null,
          extraPerSeat: Number(d.priceModifier) || 0,
        }));
        return {
          data: {
            from,
            to,
            seatCountAsked: seatCount ?? null,
            // A real answer, not an empty one: every open date in the window is full.
            allSoldOut: dates.length > 0 && dates.every((d) => d.soldOut),
            dates,
          },
          sources: [{ kind: 'live', ref: 'availability' }],
          ui: dates.length ? [{ type: 'availability', tourId: ctx.tourId, seatCount: seatCount ?? null, dates }] : [],
        };
      },
    },
    {
      name: 'active_offers',
      group: 'live',
      async run() {
        const campaigns = await deps.offers.activeCampaigns();
        // Coupon codes are not listed on purpose: they are handed out one by one. A traveller
        // who has one can type it and check_coupon will price it.
        const offers = campaigns.slice(0, 5).map((c) => ({
          name: c.name,
          discountPercent: c.discountPercent,
          endsAt: c.endsAt,
        }));
        return {
          data: { offers, couponsListed: false },
          sources: [{ kind: 'live', ref: 'offers' }],
          ui: offers.length ? [{ type: 'offers', offers }] : [],
        };
      },
    },
    {
      name: 'check_coupon',
      group: 'live',
      /**
       * "Does SAVE10 work for this tour?" Same validation the checkout uses, previewed on the
       * standard price (read-only: nothing is redeemed). Real rules apply: expiry, usage limit,
       * minimum order. It cannot reveal codes the traveller did not type.
       */
      async run(ctx, { couponCode, seatCount } = {}) {
        if (!couponCode) return { data: { needsCoupon: true } };
        if (!ctx.tourId) return { data: { needsTour: true } };

        const seats = seatCount ?? 1;
        const q = await deps.booking.quote({ tourId: ctx.tourId, seatCount: seats });
        try {
          const applied = await deps.offers.validateCoupon({ couponCode, orderTotal: q.totalAmount });
          return {
            data: {
              couponCode: applied.coupon.code,
              orderTotal: q.totalAmount,
              discountAmount: applied.discountAmount,
              finalAmount: applied.finalAmount,
              seatCount: seats,
              seatCountAssumed: !seatCount,
            },
            sources: [{ kind: 'live', ref: 'coupon' }],
          };
        } catch (err) {
          // Rules like "expired" or "minimum order" are answers, not outages. Their messages
          // are written for travellers (and do not confirm whether a code exists).
          if (err?.status === 400 && String(err.code ?? '').startsWith('COUPON_')) {
            return { data: { couponProblem: err.message, couponCode: String(couponCode).toUpperCase() } };
          }
          throw err;
        }
      },
    },
  ];
}
