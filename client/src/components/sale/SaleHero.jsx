import { useState } from 'react';
import { Link } from 'react-router-dom';
import Countdown from './Countdown.jsx';
import { ArrowIcon } from '../TourBits.jsx';
import { COUNTDOWN_WINDOW_MS } from '../../lib/campaign.js';
import { inr, stamp } from '../../lib/format.js';

/*
 * The homepage sale hero. Purely presentational: it gets a campaign (and optionally a
 * few real tours with their computed deals) and draws it. FestivalBanner feeds it live
 * data; the admin Campaign Manager feeds it the unsaved form for the live preview.
 *
 * Copy rules: every claim on this card is true by construction. The discount is the
 * campaign's exact percentage (it applies to every tour, so never "up to"); the
 * countdown exists only when the campaign has a real end date, and only inside the
 * last two weeks where a ticking clock is informative rather than decorative.
 *
 * `compact` forces the small layout regardless of viewport — the admin preview panel
 * is narrow even on a desktop screen, so viewport breakpoints would lie there.
 */

export function SaleHeroSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="min-h-[440px] animate-pulse rounded-3xl bg-sand-100 motion-reduce:animate-none md:min-h-[500px] dark:bg-ink-800"
    />
  );
}

function FeaturedTour({ tour, discount }) {
  return (
    <li>
      <Link
        to={`/tours/${tour.slug}`}
        state={{ discount }}
        className="group/f flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/10 focus-visible:bg-white/10"
      >
        {tour.cover_url ? (
          <img
            src={tour.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-14 w-14 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <span aria-hidden="true" className="h-14 w-14 shrink-0 rounded-xl bg-white/10" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{tour.title}</span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-base font-bold tabular-nums">{inr(discount.discounted)}</span>
            <s className="tabular-nums text-white/55">{inr(discount.original)}</s>
            <span className="font-semibold text-emerald-300">Save {inr(discount.saved)}</span>
          </span>
        </span>
        <ArrowIcon className="h-4 w-4 shrink-0 text-white/50 transition group-hover/f:translate-x-0.5 group-hover/f:text-white" />
      </Link>
    </li>
  );
}

export default function SaleHero({
  campaign,
  featured = [],
  fallbackImage = null,
  onExploreDeals,
  compact = false,
}) {
  const percent = Number(campaign.discountPercent);
  const wanted = campaign.bannerUrl || fallbackImage || null;
  // A mistyped banner URL must not leave a broken-image icon on the storefront.
  const [broken, setBroken] = useState(null);
  const src = wanted && broken !== wanted ? wanted : null;

  const endMs = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;
  const msLeft = endMs != null && !Number.isNaN(endMs) ? endMs - Date.now() : null;
  const showTiles = msLeft != null && msLeft > 0 && msLeft <= COUNTDOWN_WINDOW_MS;

  return (
    <section
      aria-label={`${campaign.name} sale`}
      className={`relative isolate overflow-hidden rounded-3xl bg-ink-900 text-white shadow-xl ring-1 ring-black/5 dark:ring-white/10 ${
        compact ? 'min-h-[320px]' : 'min-h-[440px] md:min-h-[500px]'
      }`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          decoding="async"
          onError={() => setBroken(src)}
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[radial-gradient(60%_80%_at_85%_0%,rgba(255,122,69,0.35),transparent_60%)]"
        />
      )}
      {/* One overlay, left-weighted: keeps the headline readable on any photo. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950/90 via-ink-900/65 to-ink-900/20 md:via-ink-900/55"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-ink-950/70 to-transparent"
      />

      <div
        className={`grid h-full items-center gap-8 ${
          compact ? 'p-5' : 'p-6 sm:p-8 md:p-12 lg:grid-cols-[1.3fr_1fr] lg:p-14'
        }`}
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ring-1 ring-white/15 backdrop-blur-md">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-glow" />
            Festival sale
          </p>

          <h2
            className={`mt-5 font-semibold text-sand-200 ${
              compact ? 'text-base' : 'text-base sm:text-lg md:text-xl'
            }`}
          >
            {campaign.name}
          </h2>

          <p
            className="mt-1 flex items-start gap-1 font-black leading-[0.9] tracking-tight"
            aria-label={`${percent} percent off`}
          >
            <span
              aria-hidden="true"
              className={`tabular-nums ${compact ? 'text-6xl' : 'text-7xl sm:text-8xl lg:text-9xl'}`}
            >
              {percent}
            </span>
            <span aria-hidden="true" className={`flex flex-col ${compact ? 'pt-1' : 'pt-2 sm:pt-3 lg:pt-4'}`}>
              <span className={compact ? 'text-2xl' : 'text-3xl sm:text-4xl lg:text-5xl'}>%</span>
              <span className={`text-glow ${compact ? 'text-lg' : 'text-xl sm:text-2xl lg:text-3xl'}`}>OFF</span>
            </span>
          </p>

          <p className={`mt-4 max-w-md text-white/85 ${compact ? 'text-sm' : 'text-sm sm:text-base md:text-lg'}`}>
            Save {percent}% on every small-group tour. Applied automatically at checkout — no code needed.
          </p>

          {campaign.endsAt && msLeft != null && msLeft > 0 && (
            <div className="mt-5">
              <p className="text-xs font-medium uppercase tracking-widest text-white/70">
                Sale ends {stamp(campaign.endsAt)}
              </p>
              {showTiles && (
                <div className="mt-2">
                  <Countdown endsAt={campaign.endsAt} />
                </div>
              )}
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onExploreDeals}
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-glow px-6 text-sm font-bold text-ink-900 shadow-lg transition hover:bg-orange-400 motion-safe:hover:-translate-y-0.5 sm:text-base"
            >
              Explore deals
              <ArrowIcon className="h-4 w-4" />
            </button>
            <Link
              to="/explore"
              className="inline-flex min-h-12 items-center rounded-full bg-white/10 px-6 text-sm font-semibold text-white ring-1 ring-white/30 backdrop-blur-md transition hover:bg-white/20 sm:text-base"
            >
              Explore destinations
            </Link>
          </div>

          <p className="mt-5 max-w-md text-xs text-white/60">
            The discount comes off the base seat price. Your final total, including any add-ons, is confirmed at
            checkout.
          </p>
        </div>

        {!compact && featured.length > 0 && (
          <aside
            aria-label="Tours on sale"
            className="hidden self-end rounded-3xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur-xl lg:block"
          >
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
              Biggest savings
            </p>
            <ul>
              {featured.map(({ tour, discount }) => (
                <FeaturedTour key={tour.id ?? tour.slug} tour={tour} discount={discount} />
              ))}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}
