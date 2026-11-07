import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTourDetail } from '../hooks/useTourDetail.js';
import TourGallery from './TourGallery.jsx';
import TourHighlights from './TourHighlights.jsx';
import TourItineraryPreview from './TourItineraryPreview.jsx';
import TourPriceBreakdown from './TourPriceBreakdown.jsx';
import {
  ArrowIcon,
  CloseIcon,
  TourPrice,
  durationLabel,
  formatTourType,
  ratingOf,
} from './TourBits.jsx';

/*
 * Premium preview, not a second detail page.
 *
 * Instant: everything the list API already gave us (cover, title, type, rating,
 * duration, teaser, price). Fetched once on open via api.getTour(slug), cached
 * by React Query: gallery, itinerary, attractions and add-on options. Missing
 * sections just don't render.
 *
 * Uses the native <dialog>: Escape, focus trap and focus-return are the
 * browser's. Page scroll is locked while open.
 */
export default function TourQuickView({ tour, discount = null, onClose }) {
  const ref = useRef(null);
  const detail = useTourDetail(tour.slug);
  const d = detail.data;

  const rating = ratingOf(tour);
  const duration = durationLabel(tour);
  const type = formatTourType(tour.tour_type);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Cover first, then the gallery, no duplicates, no extra requests.
  const images = useMemo(
    () => [...new Set([tour.cover_url, ...(d?.gallery ?? [])].filter(Boolean))],
    [tour.cover_url, d?.gallery]
  );

  const overview = d?.overview ?? tour.teaser;
  const loadingExtras = detail.isPending;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`qv-title-${tour.id}`}
      onClose={onClose}
      onClick={(e) => {
        // Only the backdrop is the <dialog> itself (it has no padding).
        if (e.target === ref.current) onClose();
      }}
      className="qv-dialog relative m-auto max-h-[92vh] w-[min(96vw,42rem)] flex-col overflow-hidden rounded-2xl border border-sand-100 bg-white p-0 text-ink-900 shadow-2xl open:flex backdrop:bg-black/60 backdrop:backdrop-blur-sm dark:border-ink-600 dark:bg-ink-900 dark:text-sand-50"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close quick view"
        className="absolute right-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-ink-900 shadow backdrop-blur transition hover:bg-white motion-safe:active:scale-90 dark:bg-ink-900/90 dark:text-sand-50"
      >
        <CloseIcon className="h-4 w-4" />
      </button>

      <div className="overflow-y-auto overscroll-contain">
        <TourGallery images={images} title={tour.title} />

        <div className="space-y-5 p-5">
          <header>
            {type && (
              <p className="text-[11px] font-semibold uppercase tracking-wider faint">{type}</p>
            )}
            <h2 id={`qv-title-${tour.id}`} className="mt-1 text-xl font-bold leading-snug sm:text-2xl">
              {tour.title}
            </h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm muted">
              {rating ? (
                <span>
                  <span className="text-glow">★</span> {rating.toFixed(1)}
                  {tour.review_count != null && ` (${tour.review_count} reviews)`}
                </span>
              ) : (
                <span>New</span>
              )}
              {duration && <span>{duration}</span>}
            </p>
          </header>

          {overview && <p className="text-sm leading-relaxed muted">{overview}</p>}

          {loadingExtras && (
            <div aria-busy="true" aria-label="Loading more details" className="animate-pulse space-y-3 motion-reduce:animate-none">
              <div className="h-4 w-1/3 rounded bg-sand-100 dark:bg-ink-800" />
              <div className="h-11 rounded-xl bg-sand-100 dark:bg-ink-800" />
              <div className="flex gap-3">
                {[0, 1, 2].map((n) => (
                  <div key={n} className="h-28 w-28 shrink-0 rounded-xl bg-sand-100 dark:bg-ink-800" />
                ))}
              </div>
            </div>
          )}

          {detail.isError && (
            <div className="notice-error flex flex-wrap items-center justify-between gap-2" role="alert">
              <span>Couldn’t load the itinerary and highlights.</span>
              <button type="button" onClick={() => detail.refetch()} className="btn-ghost min-h-9">
                Retry
              </button>
            </div>
          )}

          {d && (
            <>
              <TourItineraryPreview days={d.itinerary} slug={tour.slug} discount={discount} />
              <TourHighlights attractions={d.attractions} />
              <TourPriceBreakdown tour={tour} discount={discount} options={d.options} />
            </>
          )}
        </div>
      </div>

      <footer className="flex items-end justify-between gap-3 border-t border-sand-100 bg-white p-4 dark:border-ink-700 dark:bg-ink-900">
        <TourPrice tour={tour} discount={discount} />
        <Link
          to={`/tours/${tour.slug}`}
          state={{ discount }}
          className="btn-primary group/cta shrink-0"
        >
          Explore full tour
          <ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover/cta:translate-x-0.5" />
        </Link>
      </footer>
    </dialog>
  );
}