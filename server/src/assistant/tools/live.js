import { istDate } from '../intent.js';

/*
 * Live tools: facts that go stale the moment inventory moves, so they are read
 * from Postgres/Redis at answer time (via the existing booking/offers services)
 * and never from embeddings. Seats = total - confirmed - Redis holds.
 */

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function liveTools(deps) {
  return [
    {
      name: 'seat_availability',
      group: 'live',
      async run(ctx, { dateRange, seatCount } = {}) {
        if (!ctx.tourId) return { data: { needsTour: true } };

        const today = istDate(new Date());
        const from = dateRange?.from ?? today;
        const to = dateRange?.to ?? addDays(from, 30);

        const calendar = await deps.booking.getCalendar({ tourId: ctx.tourId, from, to });
        const open = calendar.filter((d) => d.isOpen && d.date >= today);

        const dates = open.slice(0, 10).map((d) => ({
          date: d.date,
          seatsLeft: d.availableSeats,
          fitsParty: seatCount ? d.availableSeats >= seatCount : null,
          extraPerSeat: Number(d.priceModifier) || 0,
        }));
        return {
          data: { from, to, seatCountAsked: seatCount ?? null, dates },
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
        const offers = campaigns.slice(0, 5).map((c) => ({
          name: c.name,
          discountPercent: c.discountPercent,
          endsAt: c.endsAt,
        }));
        return {
          data: { offers },
          sources: [{ kind: 'live', ref: 'offers' }],
          ui: offers.length ? [{ type: 'offers', offers }] : [],
        };
      },
    },
  ];
}
