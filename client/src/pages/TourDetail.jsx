import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { defaultSelection } from '../components/PriceConfigurator.jsx';
import AssistantLauncher from '../components/AsistantLauncher.jsx';
import TourGallery from '../components/tour/TourGallery.jsx';
import TourOverview from '../components/tour/TourOverview.jsx';
import SectionTabs from '../components/tour/SectionTabs.jsx';
import ItineraryTimeline, { normalizeName } from '../components/tour/ItineraryTimeline.jsx';
import TourInclusions from '../components/tour/TourInclusions.jsx';
import CancellationPolicy from '../components/tour/CancellationPolicy.jsx';
import AttractionMapSection from '../components/tour/AttractionMapSection.jsx';
import TourReviews from '../components/tour/TourReviews.jsx';
import BookingPanel from '../components/tour/BookingPanel.jsx';
import BottomSheet from '../components/tour/BottomSheet.jsx';
import MobileBookingBar from '../components/tour/MobileBookingBar.jsx';
import MobileAssistant from '../components/tour/MobileAssistant.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { useScrollSpy, useStickyHeaderHeight } from '../hooks/useScrollSpy.js';

/*
 * Tour detail page.
 *
 * This file owns ALL data fetching, mutations and booking state — slot, seat count,
 * options, coupon, campaign, checkout, wishlist. Everything under components/tour is
 * presentational and receives that state through props, so there is exactly one
 * source of truth whether the booking UI is the desktop rail or the mobile sheet.
 *
 * The map's heavy lifting (MapLibre, ~900kB) is lazy-loaded inside
 * AttractionMapSection and only mounts once that section is near the viewport.
 */

// Jaipur: the original page's fallback camera when a tour has no start point.
const FALLBACK_VIEW = { latitude: 26.9124, longitude: 75.7873, zoom: 11.5 };

const hasCoords = (a) =>
  a?.lat != null && a?.lng != null && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading tour">
      <div className="-mx-4 -mt-4 aspect-[4/3] bg-sand-100 md:mx-0 md:mt-0 md:aspect-auto md:h-[420px] md:rounded-3xl dark:bg-ink-800" />
      <div className="space-y-3">
        <div className="h-4 w-24 rounded bg-sand-100 dark:bg-ink-800" />
        <div className="h-9 w-3/4 rounded bg-sand-100 dark:bg-ink-800" />
        <div className="h-4 w-full max-w-xl rounded bg-sand-100 dark:bg-ink-800" />
      </div>
    </div>
  );
}

export default function TourDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isGuest } = useAuth();
  const location = useLocation();

  // Booking state — the single source of truth for the rail AND the sheet.
  const [slot, setSlot] = useState(null);
  const [seatCount, setSeatCount] = useState(2);
  const [selected, setSelected] = useState({});
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponAmount, setCouponAmount] = useState(0);
  const [checkoutError, setCheckoutError] = useState(null);

  // Presentation state.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null);
  const [mapRequested, setMapRequested] = useState(false);
  const [shareNote, setShareNote] = useState(null);
  const shareTimer = useRef(0);

  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const headerHeight = useStickyHeaderHeight();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tour', slug],
    queryFn: ({ signal }) => api.getTour(slug, signal),
    staleTime: 5 * 60_000,
  });

  const tour = data?.tour;

  // Catalogue defaults are applied once, the first time the tour lands.
  const initialSelection = useMemo(() => defaultSelection(tour?.options), [tour?.options]);
  const effectiveSelection = Object.keys(selected).length ? selected : initialSelection;

  const discountCampaign = location.state?.discount || null; // Discount campaign handed over via router state

  // 1. Fetch the wishlist to derive `isSaved` status
  const { data: wishlistData } = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api.wishlist(),
    enabled: !isGuest && !!tour?.id,
  });

  // 2. Check if the current tour is in the fetched wishlist
  const isSaved = wishlistData?.items?.some((item) => item.tour_id === tour?.id) ?? false;

  const checkout = useMutation({
    mutationFn: () =>
      api.checkout({
        slotId: slot.slotId,
        seatCount,
        selectedOptions: effectiveSelection,
        // Priced by the server BEFORE this call locks the seats — the whole reason
        // the coupon field lives on this page and not on checkout. Omitted entirely
        // when no code is applied.
        couponCode: appliedCoupon?.code || undefined,

        // Pass the campaign ID to the server so it can apply the valid campaign discount
        // Note: Change the key "campaignId" if your backend expects a different name (e.g., "discountCampaignId")
        campaignId: discountCampaign?.campaign?.id || undefined,
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

  // Bulletproof Optimistic UI implementation
  const wishlist = useMutation({
    mutationFn: () => api.toggleWishlist(tour.id),

    // 1. onMutate runs IMMEDIATELY when the button is clicked
    onMutate: async () => {
      // Cancel any outgoing fetches so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: ['wishlist'] });

      // Snapshot the previous value in case we need to roll back
      const previousWishlist = qc.getQueryData(['wishlist']);

      // Optimistically update the cache immediately (this changes the UI instantly)
      qc.setQueryData(['wishlist'], (old) => {
        if (!old) return { items: [{ tour_id: tour.id }] };

        if (isSaved) {
          // If already saved, remove it locally
          return {
            ...old,
            items: old.items.filter((item) => item.tour_id !== tour.id && item.id !== tour.id),
          };
        }
        // If not saved, add it locally
        return { ...old, items: [...(old.items || []), { tour_id: tour.id }] };
      });

      // Pass the snapshot to the onError handler
      return { previousWishlist };
    },

    // 2. If the API fails, roll back to the snapshot
    onError: (err, variables, context) => {
      if (context?.previousWishlist) {
        qc.setQueryData(['wishlist'], context.previousWishlist);
      }
    },

    // 3. Always sync with the real server state in the background once finished
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
  });

  useEffect(() => () => clearTimeout(shareTimer.current), []);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: tour.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareNote('Link copied');
        clearTimeout(shareTimer.current);
        shareTimer.current = setTimeout(() => setShareNote(null), 2200);
      }
    } catch {
      /* user dismissed the share sheet */
    }
  };

  const handleCheckout = () => {
    setCheckoutError(null);
    // The login wall lives here and nowhere earlier.
    if (isGuest) {
      navigate('/login', {
        state: { from: { pathname: `/tours/${slug}` } },
      });
      return;
    }
    checkout.mutate();
  };

  const goBack = () => {
    // `default` is the first entry of this session: nothing to go back to.
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  // ── Derived, presentation-only data ─────────────────────────────────────────
  const gallery = tour?.gallery ?? [];
  const attractions = useMemo(() => tour?.attractions ?? [], [tour?.attractions]);

  // Only attractions with usable coordinates become numbered markers, so a marker's
  // number is always its index in this list.
  const mappable = useMemo(() => attractions.filter(hasCoords), [attractions]);

  const stopIndexByName = useMemo(() => {
    const map = new Map();
    mappable.forEach((a, i) => {
      const key = normalizeName(a.name);
      if (!map.has(key)) map.set(key, i);
    });
    return map;
  }, [mappable]);

  const daysByStop = useMemo(() => {
    const map = new Map();
    for (const day of tour?.itinerary ?? []) {
      for (const stop of day.stops ?? []) {
        const i = stopIndexByName.get(normalizeName(stop));
        if (i == null) continue;
        const days = map.get(i) ?? [];
        if (!days.includes(day.day)) days.push(day.day);
        map.set(i, days);
      }
    }
    return map;
  }, [tour?.itinerary, stopIndexByName]);

  // Straight segments between consecutive stops, in visit order. Derived from real
  // coordinates only — it is a visual guide, not turn-by-turn directions.
  const route = useMemo(
    () =>
      mappable.length > 1
        ? { type: 'LineString', coordinates: mappable.map((a) => [Number(a.lng), Number(a.lat)]) }
        : null,
    [mappable]
  );

  const initialView = useMemo(() => {
    const start = tour?.start_point?.coordinates;
    if (Array.isArray(start) && Number.isFinite(start[0]) && Number.isFinite(start[1])) {
      return { latitude: start[1], longitude: start[0], zoom: FALLBACK_VIEW.zoom };
    }
    if (mappable[0]) {
      return {
        latitude: Number(mappable[0].lat),
        longitude: Number(mappable[0].lng),
        zoom: FALLBACK_VIEW.zoom,
      };
    }
    return FALLBACK_VIEW;
  }, [tour?.start_point, mappable]);

  const tabs = useMemo(
    () => [
      { id: 'itinerary', label: 'Itinerary' },
      ...(mappable.length ? [{ id: 'map', label: 'Map' }] : []),
      { id: 'reviews', label: 'Reviews' },
    ],
    [mappable.length]
  );
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);

  // Sticky stack = app header + the 3rem section tabs.
  const { active, scrollToSection } = useScrollSpy(tabIds, () => headerHeight + 48);

  const selectStopFromMap = useCallback((i) => setSelectedStop(i), []);
  const selectStopFromItinerary = useCallback(
    (i) => {
      setSelectedStop(i);
      setMapRequested(true);
      scrollToSection('map');
    },
    [scrollToSection]
  );

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  if (isPending) return <PageSkeleton />;
  if (isError)
    return (
      <p className="notice-error mx-auto max-w-lg text-center" role="alert">
        {error.message}
      </p>
    );

  const bookingProps = {
    tour,
    slot,
    onSelectSlot: setSlot,
    seatCount,
    onSeatCountChange: setSeatCount,
    selection: effectiveSelection,
    onSelectionChange: setSelected,
    couponAmount,
    discountCampaign,
    onAppliedCouponChange: setAppliedCoupon,
    onCouponAmountChange: setCouponAmount,
    checkoutError,
    isCheckingOut: checkout.isPending,
    isGuest,
    onCheckout: handleCheckout,
  };

  const sectionClass = 'scroll-mt-[calc(var(--hdr,4rem)+3.5rem)]';

  return (
    <div className="pb-20 lg:pb-0" style={{ '--hdr': `${headerHeight}px` }}>
      <nav aria-label="Breadcrumb" className="mb-4 hidden items-center gap-2 text-sm md:flex">
        <Link
          to="/"
          className="inline-flex min-h-9 items-center gap-1.5 font-semibold hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to tours
        </Link>
        <span aria-hidden className="faint">
          /
        </span>
        <span aria-current="page" className="faint truncate">
          {tour.title}
        </span>
      </nav>

      <TourGallery
        images={gallery}
        title={tour.title}
        isSaved={isSaved}
        savePending={wishlist.isPending}
        onToggleSave={() => (isGuest ? navigate('/login') : wishlist.mutate())}
        onShare={share}
        shareNote={shareNote}
        onBack={goBack}
      />

      <div className="mt-6 grid gap-8 md:mt-8 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)] lg:gap-10">
        <div className="min-w-0">
          <TourOverview
            tour={tour}
            discountCampaign={discountCampaign}
            onJumpToReviews={() => scrollToSection('reviews')}
          />

          <div className="mt-8">
            <SectionTabs tabs={tabs} active={active} onSelect={scrollToSection} />
          </div>

          <div className="space-y-14 pt-8 md:space-y-16">
            <section id="itinerary" className={sectionClass} aria-labelledby="itinerary-title">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-glow">Day by day</p>
                <h2 id="itinerary-title" className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
                  Your itinerary
                </h2>
              </div>
              <div className="space-y-6">
                <ItineraryTimeline
                  days={tour.itinerary ?? []}
                  stopIndexByName={stopIndexByName}
                  selectedStop={selectedStop}
                  onSelectStop={selectStopFromItinerary}
                />
                <TourInclusions inclusions={tour.inclusions} exclusions={tour.exclusions} />
                <CancellationPolicy tiers={tour.refund_policy} />
              </div>
            </section>

            {mappable.length > 0 && (
              <section id="map" className={sectionClass} aria-labelledby="map-title">
                <div className="mb-5">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-glow">
                    On the ground
                  </p>
                  <h2 id="map-title" className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
                    Explore the route
                  </h2>
                </div>
                <AttractionMapSection
                  attractions={attractions}
                  stops={mappable}
                  route={route}
                  initialView={initialView}
                  selectedStop={selectedStop}
                  onSelectStop={selectStopFromMap}
                  daysByStop={daysByStop}
                  requested={mapRequested}
                />
              </section>
            )}

            <section id="reviews" className={sectionClass} aria-labelledby="reviews-title">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-glow">
                  From travellers
                </p>
                <h2 id="reviews-title" className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
                  Reviews
                </h2>
              </div>
              <TourReviews tour={tour} />
            </section>
          </div>
        </div>

        {/*
          Desktop booking rail: sticky under the app header; it scrolls internally when
          taller than the viewport so the pay button is always reachable. Below lg it
          is not rendered at all — the same BookingPanel lives in the sheet instead.
        */}
        {isDesktop && (
          <aside className="space-y-4 lg:sticky lg:top-[calc(var(--hdr,4rem)+1rem)] lg:self-start">
            <BookingPanel layout="rail" {...bookingProps} />
            <AssistantLauncher tourId={tour.id} tourTitle={tour.title} />
          </aside>
        )}
      </div>

      {!isDesktop && (
        <>
          <MobileBookingBar
            basePrice={tour.base_price}
            discountCampaign={discountCampaign}
            slot={slot}
            seatCount={seatCount}
            onOpen={() => setSheetOpen(true)}
          />
          <BottomSheet open={sheetOpen} onClose={closeSheet} title="Book this trip">
            <BookingPanel layout="sheet" {...bookingProps} />
          </BottomSheet>
          <MobileAssistant tourId={tour.id} tourTitle={tour.title} />
        </>
      )}
    </div>
  );
}
