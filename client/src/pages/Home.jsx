import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import TourCard from '../components/TourCard.jsx';
import FestivalBanner from '../components/FestivalBanner.jsx';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useActiveCampaign } from '../hooks/useActiveCampaign.js';
import { useAuth } from '../context/AuthContext.jsx';
import { km } from '../lib/format.js';

/*
 * Landing page: search + filters, curated spotlights, and "Near Me".
 * Everything here works without a token — this is the guest-mode surface.
 */

const SPOTLIGHTS = [
  { key: 'MUST_VISIT', label: 'Must visit', blurb: 'The sights nobody skips' },
  { key: 'MUST_EAT', label: 'Must eat', blurb: 'Where locals actually queue' },
  { key: 'FAMOUS_RIDE', label: 'Famous rides', blurb: 'Boats, camels, ferris wheels' },
];

const SORTS = [
  ['popular', 'Popular'],
  ['price_asc', 'Cheapest'],
  ['price_desc', 'Premium'],
  ['newest', 'Newest'],
];

export default function Home() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState('popular');
  const [spotlight, setSpotlight] = useState('MUST_VISIT');
  const geo = useGeolocation();
  const { user } = useAuth();
  const { discountFor } = useActiveCampaign();

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const listQuery = useMemo(
    () => ({ q: debouncedQ || undefined, sort, limit: 12 }),
    [debouncedQ, sort]
  );

  const tours = useQuery({
    queryKey: ['tours', listQuery],
    queryFn: ({ signal }) => api.listTours(listQuery, signal),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const spots = useQuery({
    queryKey: ['spotlight', spotlight],
    queryFn: ({ signal }) => api.byCategory(spotlight, signal),
    staleTime: 5 * 60_000,
  });

  // Fires for a live fix, and also for a signed-in traveller whose position we
  // already know from sign-in or their home city — that is a good enough anchor
  // for a "near you" row and it costs them no permission prompt. It stays off for
  // an anonymous visitor, where the coordinates are just a default city.
  const hasAnchor = geo.isPrecise || Boolean(user?.lastLocation || user?.home?.lat != null);
  const near = useQuery({
    queryKey: ['nearby', geo.coords.lat, geo.coords.lng],
    queryFn: ({ signal }) =>
      api.nearby({ lat: geo.coords.lat, lng: geo.coords.lng, radius: 15_000 }, signal),
    enabled: hasAnchor,
    staleTime: 5 * 60_000,
  });

  // Precompute the festival strike-through per card. Memoised on the (cache-stable)
  // items array and the (useCallback-stable) helper so filter-keystroke re-renders
  // hand TourCard the *same* discount object and its memo keeps holding.
  const packageItems = tours.data?.items ?? [];
  const discountByTour = useMemo(() => {
    const map = {};
    for (const t of packageItems) map[t.id] = discountFor(t.base_price);
    return map;
  }, [packageItems, discountFor]);

  return (
    <div className="space-y-10">
      <FestivalBanner />

      <section className="rounded-3xl bg-ink-800 px-5 py-8 text-sand-50 md:px-8 md:py-12">
        <h1 className="text-2xl font-black leading-tight md:text-4xl">
          Small-group tours,
          <br className="hidden md:block" /> live seat counts, no surprises.
        </h1>
        <p className="mt-2 max-w-lg text-sm text-sand-300">
          Browse freely. Configure your package. You only sign in when it&apos;s time to pay.
        </p>

        <form className="mt-5 flex gap-2" role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="sr-only" htmlFor="tour-search">
            Search tours
          </label>
          <input
            id="tour-search"
            className="field flex-1 text-ink-800"
            placeholder="Jaipur, forts, food walk…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="btn-ghost" onClick={geo.request}>
            {geo.state === 'locating' ? 'Locating…' : 'Near me'}
          </button>
        </form>

        {geo.state === 'denied' && (
          <p className="mt-2 text-xs text-sand-300">
            Location is blocked in your browser — showing {geo.fallbackLabel} instead. You can set a
            home city on your profile.
          </p>
        )}
      </section>

      {near.data?.items?.length > 0 && (
        <section aria-labelledby="near-heading">
          <h2 id="near-heading" className="text-lg font-bold">
            {geo.isPrecise ? 'Around you right now' : `Around ${geo.fallbackLabel}`}
          </h2>
          <ul className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {near.data.items.map((a) => (
              <li key={a.id} className="card min-w-52 shrink-0 p-3">
                <p className="text-sm font-semibold">{a.name}</p>
                <p className="text-xs text-sand-500">
                  {km(a.distance_m)} away · {a.avg_visit_min} min visit
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="spotlight-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="spotlight-heading" className="text-lg font-bold">
            Curated spotlights
          </h2>
          <div className="flex gap-2">
            {SPOTLIGHTS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`chip min-h-11 ${
                  spotlight === s.key ? 'border-ink-800 bg-ink-800 text-sand-50 ' : 'bg-blue'
                }`}
                onClick={() => setSpotlight(s.key)}
                aria-pressed={spotlight === s.key}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-1 text-sm text-sand-500">
          {SPOTLIGHTS.find((s) => s.key === spotlight)?.blurb}
        </p>

        <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(spots.data?.items ?? []).slice(0, 8).map((a) => (
            <li key={a.id} className="card overflow-hidden">
              {a.image_url && (
                <img
                  src={a.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-video w-full object-cover"
                />
              )}
              <div className="p-3">
                <p className="text-sm font-semibold">{a.name}</p>
                <p className="text-xs text-sand-500">{a.city ?? 'Jaipur'}</p>
              </div>
            </li>
          ))}
          {spots.isPending && <li className="text-sm text-sand-500">Loading spotlights…</li>}
        </ul>
      </section>

      <section aria-labelledby="packages-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="packages-heading" className="text-lg font-bold">
            Tour packages{' '}
            {tours.data && <span className="text-sm font-normal text-sand-500">({tours.data.total})</span>}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-sand-500">Sort</span>
            <select className="field w-36" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {tours.isError && <p className="mt-4 text-sm text-red-700">{tours.error.message}</p>}

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packageItems.map((tour) => (
            <TourCard key={tour.id} tour={tour} discount={discountByTour[tour.id]} />
          ))}
        </div>

        {tours.isPending && <p className="mt-4 text-sm text-sand-500">Loading packages…</p>}
        {tours.data?.items.length === 0 && (
          <p className="mt-4 text-sm text-sand-500">Nothing matched that search.</p>
        )}
      </section>
    </div>
  );
}
