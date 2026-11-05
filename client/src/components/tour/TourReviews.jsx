import { useRef } from 'react';
import { Star } from 'lucide-react';
import ReviewThread from '../ReviewThread.jsx';
import { useInView } from '../../hooks/useInView.js';

/*
 * Reviews section: a headline rating (only when the tour has one) above the
 * existing ReviewThread. The thread — and its request — is deferred until this
 * section nears the viewport. A star-by-star breakdown is NOT shown: the client API
 * has no endpoint for it, and we don't fabricate a distribution.
 */

function Stars({ value }) {
  const filled = Math.round(Number(value) || 0);
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-5 w-5 ${
            n <= filled ? 'fill-glow text-glow' : 'text-sand-300 dark:text-ink-500'
          }`}
        />
      ))}
    </span>
  );
}

export default function TourReviews({ tour }) {
  const ref = useRef(null);
  const near = useInView(ref, { rootMargin: '400px 0px' });
  const hasRating = Boolean(tour.avg_rating) && tour.review_count > 0;

  return (
    <div ref={ref} className="space-y-5">
      {hasRating && (
        <div className="flex items-center gap-4 rounded-2xl border border-sand-200 bg-white p-5 dark:border-ink-600 dark:bg-ink-900">
          <p className="text-5xl font-black tabular-nums leading-none">
            {Number(tour.avg_rating).toFixed(1)}
          </p>
          <div>
            <Stars value={tour.avg_rating} />
            <p className="faint mt-1 text-sm">
              Based on {tour.review_count} {tour.review_count === 1 ? 'review' : 'reviews'}
            </p>
          </div>
        </div>
      )}

      {near ? (
        <ReviewThread tourId={tour.id} />
      ) : (
        <div className="h-40 animate-pulse rounded-2xl bg-sand-100 dark:bg-ink-800" aria-hidden />
      )}
    </div>
  );
}
