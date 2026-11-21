/*
 * Wires the assistant tools to the real TourMate services. Imported lazily by the
 * route so unit tests (which inject fakes) never open a Postgres or Redis connection.
 */
export async function defaultDeps() {
  const [tours, attractions, rag, pool, booking, offers] = await Promise.all([
    import('../../services/tours.service.js'),
    import('../../services/attractions.service.js'),
    import('../../services/rag.service.js'),
    import('../../db/pool.js'),
    import('../../services/booking.service.js'),
    import('../../services/offers.service.js'),
  ]);

  return {
    tours: { listTours: tours.listTours },
    attractions: { findNearby: attractions.findNearby },
    rag: { embed: rag.embed, retrieve: rag.retrieve },
    db: { query: pool.query, queryOne: pool.queryOne },
    booking: {
      getCalendar: booking.getCalendar,
      quote: booking.quote,
      getCheckoutState: booking.getCheckoutState,
    },
    offers: { activeCampaigns: offers.activeCampaigns, validateCoupon: offers.validateCoupon },
  };
}
