// frontend/src/pages/Home.jsx
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { DEALS_ANCHOR } from '../lib/campaign.js';
import TourCard from '../components/TourCard.jsx';
import TourCardSkeleton from '../components/TourCardSkeleton.jsx';
import LoadMoreTours from '../components/LoadMoreTours.jsx';
import RecentlyViewedTours from '../components/RecentlyViewedTours.jsx';
import TourComparison from '../components/TourComparison.jsx';
import { useCompare } from '../hooks/useCompare.js';
import FestivalBanner from '../components/FestivalBanner.jsx';
import SpotlightModal from '../components/SpotlightModal.jsx'; // 1. Added Missing Import
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useActiveCampaign } from '../hooks/useActiveCampaign.js';
import { PAGE_SIZE, useTourPackages } from '../hooks/useTourPackages.js';
import { useWishlist } from '../hooks/useWishlist.js';
import { useAuth } from '../context/AuthContext.jsx';
import { km } from '../lib/format.js';

/*
 * Landing page: search + filters, curated spotlights, and "Near Me".
 * Everything here works without a token — this is the guest-mode surface.
 */

// Constants should remain outside to prevent re-creation on every render
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
  // 2. MOVED HOOKS INSIDE THE COMPONENT
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState('popular');
  const [spotlight, setSpotlight] = useState(SPOTLIGHTS[0]?.key);
  const [selectedSpotlightId, setSelectedSpotlightId] = useState(null); // Modal visibility state

  const geo = useGeolocation();
  const { user } = useAuth();
  const { discountFor, primary } = useActiveCampaign();
  const { hash } = useLocation();

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  // "/#deals" (the announcement bar's CTA on other pages) lands on the tour grid.
  useEffect(() => {
    if (hash !== `#${DEALS_ANCHOR}`) return undefined;
    const id = setTimeout(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document
        .getElementById(DEALS_ANCHOR)
        ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }, 60);
    return () => clearTimeout(id);
  }, [hash]);

  // Progressive (6-at-a-time) tour list. Uses the debounced search term, so
  // typing doesn't fire a request per keystroke; q/sort changes restart at offset 0.
  const pkg = useTourPackages({ q: debouncedQ || undefined, sort });
  const wishlist = useWishlist();
  const compare = useCompare();

  const spots = useQuery({
    queryKey: ['spotlight', spotlight],
    queryFn: ({ signal }) => api.byCategory(spotlight, signal),
    staleTime: 5 * 60_000,
  });

  // Fires for a live fix, and also for a signed-in traveller whose position we
  // already know from sign-in or their home city.
  const hasAnchor = geo.isPrecise || Boolean(user?.lastLocation || user?.home?.lat != null);
  const near = useQuery({
    queryKey: ['nearby', geo.coords.lat, geo.coords.lng],
    queryFn: ({ signal }) =>
      api.nearby({ lat: geo.coords.lat, lng: geo.coords.lng, radius: 15_000 }, signal),
    enabled: hasAnchor,
    staleTime: 5 * 60_000,
  });

  // Precompute the festival strike-through per card. 
  const discountByTour = useMemo(() => {
    const map = {};
    for (const t of pkg.items) map[t.id] = discountFor(t.base_price);
    return map;
  }, [pkg.items, discountFor]);

  return (
    // Extra bottom space while the compare bar is showing so it never covers content.
    <div className={`space-y-10 ${compare.selected.length > 0 ? 'pb-28' : ''}`}>
      <FestivalBanner tours={pkg.items} />

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

      {/* Near Me Section */}
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
      
{/* Curated Spotlights Section */}
      <section aria-labelledby="spotlight-heading" className="py-2">
        {/* Header */}
        <header className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sand-500">
            Discover something special
          </p>
          <h2
            id="spotlight-heading"
            className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl"
          >
            Explore the best of every destination
          </h2>
          <p className="mt-2 text-sm text-sand-500 sm:text-base">
            Handpicked experiences, local favourites and unforgettable adventures.
          </p>
        </header>

        {/* Category pills (horizontally scrollable on mobile) */}
        <div
          role="group"
          aria-label="Spotlight categories"
          className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {SPOTLIGHTS.map((s) => {
            const active = spotlight === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSpotlight(s.key)}
                aria-pressed={active}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-800 focus-visible:ring-offset-2 ${
                  active
                    ? 'border-ink-800 bg-ink-800 text-sand-50 shadow-md'
                    : 'border-sand-500/30 bg-transparent hover:-translate-y-0.5 hover:border-ink-800 hover:shadow-sm active:translate-y-0'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
                    active ? 'bg-sand-50' : 'bg-sand-500/50'
                  }`}
                />
                {s.label}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-sm text-sand-500" aria-live="polite">
          {SPOTLIGHTS.find((s) => s.key === spotlight)?.blurb}
        </p>

        {/* Cards:
            mobile  -> horizontal snap scroller
            tablet  -> 2-column grid
            desktop -> 4-column editorial grid (first card featured 2x2, 6th card wide) */}
        <ul
          className="-mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:auto-rows-[240px] sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 lg:auto-rows-[210px] [&::-webkit-scrollbar]:hidden"
        >
          {(spots.data?.items ?? []).slice(0, 8).map((a, i) => {
            const categoryLabel =
              SPOTLIGHTS.find((s) => s.key === spotlight)?.label ?? 'Spotlight';
            const layout =
              i === 0
                ? 'lg:col-span-2 lg:row-span-2'
                : i === 5
                  ? 'lg:col-span-2'
                  : '';
            const city = a.city ?? 'Jaipur';
            return (
              <li
                key={a.id}
                className={`h-72 w-[72%] shrink-0 snap-start sm:h-auto sm:w-auto ${layout}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedSpotlightId(a.id)}
                  aria-label={`${a.name}, ${city}. View details`}
                  className="group relative block h-full w-full overflow-hidden rounded-3xl bg-ink-800 text-left shadow-sm transition-shadow duration-300 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-800 focus-visible:ring-offset-2"
                >
                  {a.image_url ? (
                    <img
                      src={a.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-ink-800 to-sand-500/60"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-12 w-12 text-sand-50/40"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                    </div>
                  )}

                  {/* Bottom gradient for text readability */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent"
                  />

                  {/* Category indicator */}
                  <span className="absolute left-4 top-4 rounded-full bg-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white backdrop-blur-md">
                    {categoryLabel}
                  </span>

                  {/* Explore arrow */}
                  <span
                    aria-hidden="true"
                    className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-all duration-300 group-hover:bg-white group-hover:text-ink-800"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M7 17 17 7M8 7h9v9" />
                    </svg>
                  </span>

                  {/* Text */}
                  <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                    <p
                      className={`font-bold leading-tight text-white ${
                        i === 0 ? 'text-xl sm:text-2xl lg:text-3xl' : 'text-base sm:text-lg'
                      }`}
                    >
                      {a.name}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-white/80 sm:text-sm">
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                      {city}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}

          {/* Loading skeletons */}
          {spots.isPending &&
            [0, 1, 2, 3].map((n) => (
              <li
                key={`skeleton-${n}`}
                aria-hidden="true"
                className="h-72 w-[72%] shrink-0 animate-pulse rounded-3xl bg-sand-500/15 sm:h-auto sm:w-auto"
              />
            ))}
          {spots.isPending && <li className="sr-only">Loading spotlights…</li>}
        </ul>
      </section>

      {/* Renders the Spotlight Mapbox Modal */}
      <SpotlightModal 
        spotlightId={selectedSpotlightId} 
        onClose={() => setSelectedSpotlightId(null)} 
      />
      
{/* Recently viewed (renders nothing when empty) */}
      <RecentlyViewedTours discountFor={discountFor} />

      {/* Packages Section */}
      <section id={DEALS_ANCHOR} aria-labelledby="packages-heading" className="scroll-mt-24">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sand-500 dark:text-sand-400">
              Discover your next adventure
            </p>
            <h2
              id="packages-heading"
              className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl"
            >
              Find your next unforgettable journey.
            </h2>
            <p className="mt-2 text-sm muted sm:text-base">
              From peaceful escapes to thrilling adventures, discover experiences worth travelling
              for.
            </p>
          </div>
 
          <div className="flex items-center gap-3">
            {primary && (
              <span className="chip border-glow/50 bg-glow/10 font-semibold dark:text-sand-50">
                {primary.discountPercent}% off every tour
              </span>
            )}
            {pkg.data && (
              <span className="chip dark:text-sand-100" aria-live="polite">
                {pkg.total} {pkg.total === 1 ? 'tour' : 'tours'}
              </span>
            )}
            <label className="flex items-center gap-2 text-sm">
              <span className="faint">Sort</span>
              <select className="field w-44" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>
 
        {wishlist.notice && (
          <p role="status" className="notice-ok mt-4">
            {wishlist.notice}
          </p>
        )}
 
        {/* Initial load failed (nothing to preserve) */}
        {pkg.isError && !pkg.data && (
          <div className="notice-error mt-6 flex flex-wrap items-center justify-between gap-3" role="alert">
            <span>{pkg.error?.message ?? 'Couldn’t load tours.'}</span>
            <button type="button" className="btn-ghost min-h-10" onClick={() => pkg.refetch()}>
              Try again
            </button>
          </div>
        )}
 
       <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {pkg.items.map((tour) => (
            <TourCard
              key={tour.id}
              tour={tour}
              discount={discountByTour[tour.id]}
              saved={wishlist.savedIds.has(tour.id)}
              savePending={wishlist.pendingId === tour.id}
              onToggleSave={wishlist.toggle}
              compared={compare.ids.has(tour.id)}
              compareDisabled={compare.full}
              onToggleCompare={compare.toggle}
            />
          ))}
 
          {/* First page skeletons */}
          {pkg.isPending &&
            Array.from({ length: PAGE_SIZE }, (_, i) => <TourCardSkeleton key={`sk-${i}`} />)}
 
          {/* Next batch skeletons */}
          {pkg.isFetchingNextPage &&
            Array.from(
              { length: Math.max(1, Math.min(PAGE_SIZE, pkg.total - pkg.items.length)) },
              (_, i) => <TourCardSkeleton key={`sk-next-${i}`} />
            )}
        </div>
 
        {/* Empty state */}
        {pkg.data && pkg.items.length === 0 && (
          <div className="card mx-auto mt-6 max-w-md p-8 text-center">
            <p className="text-lg font-semibold">No journeys found.</p>
            <p className="mt-1 text-sm muted">
              Try a different search, or browse everything we offer.
            </p>
            {q && (
              <button type="button" className="btn-primary mt-4" onClick={() => setQ('')}>
                Clear search
              </button>
            )}
          </div>
        )}
 
        {pkg.items.length > 0 && (
          <LoadMoreTours
            shown={pkg.items.length}
            total={pkg.total}
            hasMore={Boolean(pkg.hasNextPage)}
            loading={pkg.isFetchingNextPage}
            error={pkg.isFetchNextPageError}
            onLoadMore={() => pkg.fetchNextPage()}
          />
        )}
      </section>

      <TourComparison
        selected={compare.selected}
        onRemove={compare.remove}
        onClear={compare.clear}
        discountFor={discountFor}
      />
    </div>
  );
}