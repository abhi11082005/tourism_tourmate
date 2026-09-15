import { lazy, Suspense, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import SeatCalendar from '../components/SeatCalendar.jsx';
import PriceConfigurator, { defaultSelection } from '../components/PriceConfigurator.jsx';
import AssistantPanel from '../components/AssistantPanel.jsx';
import ReviewThread from '../components/ReviewThread.jsx';
import CouponField from '../components/CouponField.jsx';
import { inr } from '../lib/format.js';

// The map is ~900kB of MapLibre GL. Loading it lazily keeps the detail page's
// first paint fast; the itinerary above the fold does not need WebGL.
const MapCanvas = lazy(() => import('../components/MapCanvas.jsx'));

const TABS = ['Itinerary', 'Map', 'Reviews'];

export default function TourDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isGuest } = useAuth();

  const [tab, setTab] = useState('Itinerary');
  const [slot, setSlot] = useState(null);
  const [seatCount, setSeatCount] = useState(2);
  const [selected, setSelected] = useState({});
  const [couponCode, setCouponCode] = useState(null);
  const [checkoutError, setCheckoutError] = useState(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tour', slug],
    queryFn: ({ signal }) => api.getTour(slug, signal),
    staleTime: 5 * 60_000,
  });

  const tour = data?.tour;

  // Catalogue defaults are applied once, the first time the tour lands.
  const initialSelection = useMemo(() => defaultSelection(tour?.options), [tour?.options]);
  const effectiveSelection = Object.keys(selected).length ? selected : initialSelection;

  const checkout = useMutation({
    mutationFn: () =>
      api.checkout({
        slotId: slot.slotId,
        seatCount,
        selectedOptions: effectiveSelection,
        // Priced by the server BEFORE this call locks the seats — the whole reason
        // the coupon field lives on this page and not on checkout. Omitted entirely
        // when no code is applied.
        couponCode: couponCode || undefined,
      }),
    onSuccess: (result) => {
      // Seats are now held in Redis for 10 minutes — go straight to payment.
      qc.invalidateQueries({ queryKey: ['calendar', tour.id] });
      navigate(`/checkout/${result.bookingId}`);
    },
    onError: (err) => {
      setCheckoutError(err.message);
      // Someone else took seats while this page sat open: refresh the calendar.
      if (err instanceof ApiError && err.status === 409) {
        qc.invalidateQueries({ queryKey: ['calendar', tour.id] });
        setSlot(null);
      }
    },
  });

  const wishlist = useMutation({
    mutationFn: () => api.toggleWishlist(tour.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  });

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: tour.title, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* user dismissed the share sheet */
    }
  };

  if (isPending) return <p className="py-10 text-center text-sm text-sand-500">Loading tour…</p>;
  if (isError) return <p className="py-10 text-center text-sm text-red-700">{error.message}</p>;

  const gallery = tour.gallery ?? [];
  const stops = (tour.attractions ?? []).map((a) => ({ lat: a.lat, lng: a.lng, name: a.name }));

  return (
    <div className="space-y-6">
      <nav className="text-xs text-sand-500">
        <Link to="/" className="hover:underline">
          Tours
        </Link>{' '}
        / {tour.title}
      </nav>

      <header className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
        <div className="overflow-hidden rounded-2xl bg-sand-100">
          {gallery[0]?.url ? (
            <img
              src={gallery[0].url}
              alt={gallery[0].alt ?? tour.title}
              className="aspect-[16/10] w-full object-cover"
            />
          ) : (
            <div className="grid aspect-[16/10] place-items-center text-sm text-sand-500">
              Admin hasn&apos;t uploaded photos yet
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <h1 className="text-2xl font-black leading-tight">{tour.title}</h1>
          <p className="mt-1 text-sm text-ink-700">
            {tour.duration_days}D / {tour.duration_nights}N ·{' '}
            <span className="capitalize">
              {String(tour.tour_type ?? '').toLowerCase().replace(/_/g, ' ')}
            </span>
            {tour.avg_rating && (
              <>
                {' '}
                · <span className="text-glow">★</span> {Number(tour.avg_rating).toFixed(1)} (
                {tour.review_count})
              </>
            )}
          </p>
          <p className="mt-3 text-sm">{tour.overview}</p>
          <p className="mt-4 text-lg font-bold">
            {inr(tour.base_price)} <span className="text-xs font-normal text-sand-500">/seat</span>
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => (isGuest ? navigate('/login') : wishlist.mutate())}
            >
              ♡ Save
            </button>
            <button type="button" className="btn-ghost flex-1" onClick={share}>
              Share
            </button>
          </div>
        </div>
      </header>

      {gallery.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {gallery.slice(1).map((img) => (
            <li key={img.url} className="shrink-0">
              <img
                src={img.url}
                alt={img.alt ?? ''}
                loading="lazy"
                decoding="async"
                className="h-24 w-36 rounded-xl object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="flex gap-2 border-b border-sand-100" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                type="button"
                onClick={() => setTab(t)}
                className={`min-h-11 px-3 text-sm font-semibold ${
                  tab === t ? 'border-b-2 border-ink-800' : 'text-sand-500'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'Itinerary' && (
            <div className="space-y-3">
              <ol className="space-y-3">
                {(tour.itinerary ?? []).map((day) => (
                  <li key={day.day} className="card p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-sand-500">
                      Day {day.day}
                    </p>
                    <p className="font-semibold">{day.title}</p>
                    {day.summary && <p className="mt-1 text-sm text-ink-700">{day.summary}</p>}
                    {day.stops?.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1">
                        {day.stops.map((s) => (
                          <li key={s} className="chip">
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>

              <div className="grid gap-3 sm:grid-cols-2">
                <section className="card p-4">
                  <h3 className="text-sm font-semibold">What&apos;s included</h3>
                  <ul className="mt-2 space-y-1 text-sm text-ink-700">
                    {(tour.inclusions ?? []).map((i) => (
                      <li key={i}>✓ {i}</li>
                    ))}
                  </ul>
                </section>
                <section className="card p-4">
                  <h3 className="text-sm font-semibold">Not included</h3>
                  <ul className="mt-2 space-y-1 text-sm text-ink-700">
                    {(tour.exclusions ?? []).map((i) => (
                      <li key={i}>✕ {i}</li>
                    ))}
                  </ul>
                </section>
              </div>

              {tour.refund_policy?.length > 0 && (
                <section className="card p-4">
                  <h3 className="text-sm font-semibold">Cancellation</h3>
                  <ul className="mt-2 space-y-1 text-sm text-ink-700">
                    {tour.refund_policy.map((tier) => (
                      <li key={tier.daysBefore}>
                        {tier.daysBefore}+ days before departure — {tier.refundPercent}% refunded
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {tab === 'Map' && (
            <Suspense
              fallback={<div className="h-[60vh] animate-pulse rounded-2xl bg-sand-100" />}
            >
              <MapCanvas
                pins={tour.attractions ?? []}
                stops={stops}
                initialView={{
                  latitude: tour.start_point?.coordinates?.[1] ?? 26.9124,
                  longitude: tour.start_point?.coordinates?.[0] ?? 75.7873,
                  zoom: 11.5,
                }}
              />
            </Suspense>
          )}

          {tab === 'Reviews' && <ReviewThread tourId={tour.id} />}
        </div>

        {/* Booking rail. Sticky on desktop so the price never scrolls away. */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <SeatCalendar tourId={tour.id} value={slot} onSelect={setSlot} seatCount={seatCount} />

          <PriceConfigurator
            tour={tour}
            slotId={slot?.slotId}
            seatCount={seatCount}
            onSeatCountChange={setSeatCount}
            selected={effectiveSelection}
            onSelectedChange={setSelected}
            maxSeats={Math.min(20, slot?.availableSeats ?? 20)}
          />

          <CouponField
            tourId={tour.id}
            slotId={slot?.slotId}
            seatCount={seatCount}
            selectedOptions={effectiveSelection}
            onAppliedChange={setCouponCode}
          />

          {checkoutError && (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
              {checkoutError}
            </p>
          )}

          <button
            type="button"
            className="btn-primary w-full"
            disabled={!slot || checkout.isPending}
            onClick={() => {
              setCheckoutError(null);
              // The login wall lives here and nowhere earlier.
              if (isGuest) {
                navigate('/login', {
                  state: { from: { pathname: `/tours/${slug}` } },
                });
                return;
              }
              checkout.mutate();
            }}
          >
            {!slot
              ? 'Pick a date first'
              : checkout.isPending
                ? 'Holding your seats…'
                : isGuest
                  ? 'Sign in to book'
                  : `Hold ${seatCount} ${seatCount === 1 ? 'seat' : 'seats'} for 10 min`}
          </button>

          <AssistantPanel tourId={tour.id} tourTitle={tour.title} />
        </aside>
      </div>
    </div>
  );
}
