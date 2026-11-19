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
        return { data: { total, tours: items.map(card) }, sources: [{ kind: 'tours' }] };
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
        return { data: { tours: items.map(card) }, sources: [{ kind: 'tours', ref: 'cheapest' }] };
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
        return {
          data: {
            attractions: rows.map((a) => ({
              id: a.id,
              name: a.name,
              category: a.category,
              city: a.city,
              distanceMeters: a.distance_m,
            })),
          },
          sources: [{ kind: 'attractions', ref: 'nearby' }],
        };
      },
    },
  ];
}
