import { memo } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../lib/format.js';

/*
 * Package card. Memoised because the listing page re-renders on every filter
 * keystroke and a grid of 12 cards with images is the expensive part.
 *
 * `discount` is the display-only object from useActiveCampaign().discountFor — a
 * stable, memoised value on the listing page, so passing it never defeats the memo.
 * When present the card shows the campaign price struck through the original; the
 * real total is still re-derived server-side at quote/checkout.
 */
function TourCard({ tour, saved = false, onToggleSave, discount = null }) {
  const rating = tour.avg_rating ? Number(tour.avg_rating) : null;

  return (
    <article className="card group flex flex-col overflow-hidden dark:bg-ink-900 dark:border-ink-700">
      <div className="relative aspect-[4/3] overflow-hidden bg-sand-100 dark:bg-ink-800">
        {tour.cover_url ? (
          <img
            src={tour.cover_url}
            alt={tour.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-sand-500 dark:text-sand-400">
            No photo yet
          </div>
        )}

        {onToggleSave && (
          <button
            type="button"
            onClick={() => onToggleSave(tour.id)}
            aria-pressed={saved}
            aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
            className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-lg shadow backdrop-blur transition-colors hover:bg-white dark:bg-ink-900/90 dark:text-sand-50 dark:hover:bg-ink-900"
          >
            {saved ? '♥' : '♡'}
          </button>
        )}

        <span className="absolute bottom-2 left-2 chip bg-white/90 backdrop-blur dark:bg-ink-900/90 dark:text-sand-50 dark:border-ink-700">
          {tour.duration_days}D / {tour.duration_nights}N
        </span>
      </div>

      {/* Main content container ensuring base text color is set for dark mode */}
      <div className="flex flex-1 flex-col p-4 text-ink-900 dark:text-sand-50">
        <h3 className="text-base font-semibold leading-snug">
          <Link to={`/tours/${tour.slug}`} className="hover:underline">
            {tour.title}
          </Link>
        </h3>

        <p className="mt-1 line-clamp-2 text-sm text-ink-700 dark:text-sand-300">
          {tour.teaser}
        </p>

        <div className="mt-3 flex items-center gap-2 text-xs text-sand-500 dark:text-sand-400">
          <span className="chip capitalize dark:bg-ink-800 dark:border-ink-700">
            {String(tour.tour_type ?? '').toLowerCase().replace(/_/g, ' ')}
          </span>
          {rating ? (
            <span aria-label={`Rated ${rating} out of 5`}>
              <span className="text-glow">★</span> {rating.toFixed(1)} ({tour.review_count})
            </span>
          ) : (
            <span>New</span>
          )}
        </div>

        <footer className="mt-4 flex items-end justify-between gap-2">
          {discount ? (
            <p>
              <span className="text-lg font-bold text-glow">{inr(discount.discounted)}</span>
              <span className="text-xs text-sand-500 dark:text-sand-400"> /seat</span>{' '}
              <span className="text-xs text-sand-500 line-through dark:text-sand-400">
                {inr(discount.original)}
              </span>
              <span className="block text-[11px] font-semibold text-glow">
                {discount.percent}% off · {discount.label}
              </span>
            </p>
          ) : (
            <p>
              <span className="text-lg font-bold">{inr(tour.base_price)}</span>
              <span className="text-xs text-sand-500 dark:text-sand-400"> /seat</span>
              {Number(tour.max_price) > Number(tour.base_price) && (
                <span className="block text-[11px] text-sand-500 dark:text-sand-400">
                  up to {inr(tour.max_price)} fully loaded
                </span>
              )}
            </p>
          )}
          <Link to={`/tours/${tour.slug}`} className="btn-primary">
            View dates
          </Link>
        </footer>
      </div>
    </article>
  );
}

export default memo(TourCard);