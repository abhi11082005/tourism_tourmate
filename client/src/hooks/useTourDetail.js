import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/*
 * Extra detail for Quick View, loaded only when it opens (api.getTour(slug)).
 *
 * ASSUMPTION — every guess about the detail response's field names lives in
 * normalizeTourDetail below, so fixing a name is a one-line change here and
 * nowhere else. Any section whose data is missing is simply not rendered; no
 * content is ever invented.
 */
const arr = (v) => (Array.isArray(v) ? v : []);
const urlOf = (x) => (typeof x === 'string' ? x : (x?.url ?? x?.image_url ?? x?.src ?? null));

export function normalizeTourDetail(raw) {
  const d = raw?.tour ?? raw ?? {};

  const gallery = arr(d.gallery ?? d.images ?? d.photos).map(urlOf).filter(Boolean);

  const itinerary = arr(d.itinerary ?? d.itinerary_days ?? d.days)
    .map((day, i) => ({
      key: day?.id ?? day?.day_number ?? day?.day ?? i,
      day: day?.day_number ?? day?.day ?? i + 1,
      title: day?.title ?? day?.name ?? null,
      description: day?.description ?? day?.summary ?? null,
    }))
    .filter((x) => x.title || x.description);

  const attractions = arr(d.attractions ?? d.places ?? d.stops)
    .map((a) => {
      const at = a?.attraction ?? a;
      return {
        id: at?.id,
        name: at?.name,
        image_url: at?.image_url ?? at?.imageUrl ?? null,
        category: at?.category ?? null,
      };
    })
    .filter((a) => a.id != null && a.name);

  const options = arr(d.options ?? d.package_options ?? d.addons)
    .map((o) => ({
      id: o?.id,
      name: o?.name ?? o?.label,
      price: o?.price ?? o?.extra_price ?? o?.price_delta ?? null,
    }))
    .filter((o) => o.name && o.price != null && o.price !== '');

  return { overview: d.description ?? d.overview ?? null, gallery, itinerary, attractions, options };
}

export function useTourDetail(slug) {
  return useQuery({
    // Own key so this never collides with whatever the detail page caches.
    queryKey: ['tour-quickview', slug],
    queryFn: ({ signal }) => api.getTour(slug, signal),
    select: normalizeTourDetail,
    staleTime: 5 * 60_000,
    enabled: Boolean(slug),
  });
}