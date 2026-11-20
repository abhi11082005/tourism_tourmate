/*
 * Discovery tools: "find me something". Read-only wrappers over the existing
 * tours and attractions services. Guest-safe: only published tours are visible.
 */

const card = (t) => ({
  id: t.id,
  title: t.title,
  slug: t.slug,
  tourType: t.tour_type,
  basePrice: t.base_price,
  days: t.duration_days,
  nights: t.duration_nights,
  rating: t.avg_rating ?? null,
  reviews: t.review_count ?? 0,
  teaser: t.teaser,
});

export function discoveryTools(deps) {
  return [
    {
      name: 'search_tours',
      group: 'discovery',
      async run(_ctx, { term, maxPrice, maxDays, sort = 'popular' } = {}) {
        const { items, total } = await deps.tours.listTours({
          q: term || undefined,
          maxPrice: maxPrice ?? undefined,
          maxDays: maxDays ?? undefined,
          sort,
          limit: 5,
        });
        const tours = items.map(card);
        return {
          data: { total, tours },
          sources: [{ kind: 'tours' }],
          ui: tours.length ? [{ type: 'tour_cards', tours }] : [],
        };
      },
    },
    {
      name: 'cheapest_tours',
      group: 'discovery',
      async run(_ctx, { maxPrice } = {}) {
        const { items } = await deps.tours.listTours({
          maxPrice: maxPrice ?? undefined,
          sort: 'price_asc',
          limit: 5,
        });
        const tours = items.map(card);
        return {
          data: { tours },
          sources: [{ kind: 'tours', ref: 'cheapest' }],
          ui: tours.length ? [{ type: 'tour_cards', tours }] : [],
        };
      },
    },
    {
      name: 'nearby_attractions',
      group: 'discovery',
      async run(ctx, { radiusMeters = 5000 } = {}) {
        if (!ctx.location) {
          return { data: { needsLocation: true } };
        }
        const rows = await deps.attractions.findNearby({
          lat: ctx.location.lat,
          lng: ctx.location.lng,
          radiusMeters,
          limit: 6,
        });
        const attractions = rows.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category,
          city: a.city,
          distanceMeters: a.distance_m,
        }));
        return {
          data: { attractions },
          sources: [{ kind: 'attractions', ref: 'nearby' }],
          ui: attractions.length ? [{ type: 'nearby', attractions }] : [],
        };
      },
    },
  ];
}
