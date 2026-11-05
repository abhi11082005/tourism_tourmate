import { useState } from 'react';
import { Star } from 'lucide-react';
import PriceTag from './PriceTag.jsx';
import TourQuickFacts, { prettyCategory } from './TourQuickFacts.jsx';

/*
 * Title block under the hero: category, headline, rating, overview, "from" price and
 * the quick facts. Rating and category only render when the tour actually has them.
 */

const CLAMP_AT = 220;

export default function TourOverview({ tour, discountCampaign, onJumpToReviews }) {
  const [expanded, setExpanded] = useState(false);
  const category = prettyCategory(tour.tour_type);
  const hasRating = Boolean(tour.avg_rating);
  const overview = tour.overview ?? '';
  const long = overview.length > CLAMP_AT;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {category && (
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-glow">{category}</span>
          )}
          {hasRating && (
            <button
              type="button"
              onClick={onJumpToReviews}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg font-semibold hover:underline"
              aria-label={`Rated ${Number(tour.avg_rating).toFixed(1)} out of 5 from ${tour.review_count} reviews. Jump to reviews`}
            >
              <Star className="h-4 w-4 fill-glow text-glow" aria-hidden />
              <span className="tabular-nums">{Number(tour.avg_rating).toFixed(1)}</span>
              <span className="faint font-normal">({tour.review_count})</span>
            </button>
          )}
        </div>

        <h1 className="mt-2 text-3xl font-black leading-[1.1] tracking-tight text-balance sm:text-4xl lg:text-[2.75rem]">
          {tour.title}
        </h1>

        {overview && (
          <div className="mt-3 max-w-2xl">
            <p
              className={`muted text-[15px] leading-relaxed ${
                long && !expanded ? 'line-clamp-3 md:line-clamp-none' : ''
              }`}
            >
              {overview}
            </p>
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-1 min-h-9 text-sm font-semibold underline underline-offset-4 md:hidden"
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="faint mb-1 text-[11px] font-semibold uppercase tracking-wide">
          Starting price per seat
        </p>
        <PriceTag basePrice={tour.base_price} discountCampaign={discountCampaign} size="lg" />
      </div>

      <TourQuickFacts tour={tour} />
    </div>
  );
}
