import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TourQuickView from './TourQuickView.jsx';
import {
  ArrowIcon,
  ChevronIcon,
  HeartIcon,
  PinIcon,
  ShareIcon,
  durationLabel,
  formatTourType,
  hasPriceRange,
  ratingOf,
} from './TourBits.jsx';
import { inr } from '../lib/format.js';
import DealPrice from './sale/DealPrice.jsx';

/* ------------------------------------------------------------ small pieces */

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};
const ClockIcon = ({ className }) => (
  <svg {...svg} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const ExpandIcon = ({ className }) => (
  <svg {...svg} className={className}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);
const CompareIcon = ({ checked, className }) => (
  <svg {...svg} className={className}>
    {checked ? <path d="m5 12 5 5 9-10" /> : <path d="M12 5v14M5 12h14" />}
  </svg>
);

/*
 * One floating round control. Icon-only (44px on touch, 40px on desktop) with a
 * tooltip on hover/keyboard focus; the aria-label carries the accessible name.
 */
function DockButton({ label, tip, onClick, pressed, disabled, busy, active, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={busy}
      disabled={disabled}
      className={`group/dock relative grid h-11 w-11 place-items-center rounded-full shadow-md backdrop-blur-md transition duration-200 motion-safe:active:scale-90 disabled:cursor-not-allowed disabled:opacity-60 md:h-10 md:w-10 ${
        active
          ? 'bg-white text-ink-900'
          : 'bg-black/35 text-white hover:bg-white hover:text-ink-900 focus-visible:bg-white focus-visible:text-ink-900'
      }`}
    >
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] font-medium text-sand-50 opacity-0 shadow-lg transition group-hover/dock:opacity-100 group-focus-visible/dock:opacity-100 md:block"
      >
        {tip ?? label}
      </span>
    </button>
  );
}

/* Same data as TourPrice, styled for white-on-photo. Display only. */
function OverlayPrice({ tour, discount }) {
  if (discount) return <DealPrice deal={discount} />;
  return (
    <p className="min-w-0 leading-tight">
      <span className="block text-[10px] font-medium uppercase tracking-wider text-white/60">From</span>
      <span className="text-xl font-bold">{inr(tour.base_price)}</span>
      <span className="text-xs text-white/70"> /seat</span>
      {hasPriceRange(tour) && (
        <span className="block text-[11px] text-white/60">up to {inr(tour.max_price)} fully loaded</span>
      )}
    </p>
  );
}

/* Dark on purpose, so the white text on top of it stays readable in both themes. */
function NoPhoto({ title }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900 text-white/40"
    >
      <PinIcon className="h-10 w-10" />
      <span className="line-clamp-1 max-w-[70%] text-xs">{title}</span>
    </div>
  );
}

/*
 * Immersive package card: full-bleed photo, title + teaser at the bottom-left,
 * round arrow button at the bottom-right.
 *
 * Parent API is unchanged: tour, saved, savePending, onToggleSave, discount,
 * compared, compareDisabled, onToggleCompare.
 *
 * Always visible: category, title, teaser, rating, duration, price, the arrow
 * button and the four floating controls (save, share, compare, quick view).
 * Revealed on interaction: a facts panel that grows upward inside the fixed-ratio
 * card, so nothing around it moves. Desktop: hover or keyboard focus. Touch: the
 * Details toggle.
 * Desktop mouse only: the photo drifts slightly against the pointer.
 *
 * No interactive element is nested inside another: the full-card click target is
 * a sibling overlay <Link>, and every control sits above it.
 */
function TourCard({
  tour,
  saved = false,
  savePending = false,
  onToggleSave,
  discount = null,
  compared = false,
  compareDisabled = false,
  onToggleCompare,
}) {
  const rating = ratingOf(tour);
  const duration = durationLabel(tour);
  const type = formatTourType(tour.tour_type);
  const peekId = useId();

  const [imgState, setImgState] = useState(tour.cover_url ? 'loading' : 'none');
  const imgRef = useRef(null);
  const mediaRef = useRef(null);
  const raf = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [pop, setPop] = useState(false);
  const toastTimer = useRef(null);
  const popTimer = useRef(null);

  // A cached image can finish loading before React attaches onLoad.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setImgState('loaded');
  }, []);
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      clearTimeout(popTimer.current);
      cancelAnimationFrame(raf.current);
    },
    []
  );

  /* ---- pointer parallax (mouse only, never with reduced motion) ---- */
  const onPointerMove = useCallback((e) => {
    if (e.pointerType !== 'mouse' || !mediaRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (mediaRef.current) {
        mediaRef.current.style.transform = `translate3d(${(-x * 16).toFixed(1)}px, ${(-y * 16).toFixed(1)}px, 0)`;
      }
    });
  }, []);
  const onPointerLeave = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (mediaRef.current) mediaRef.current.style.transform = '';
  }, []);

  /* ---- feedback toast ---- */
  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Confirm a wishlist change only when the user caused it and it succeeded.
  // (`saved` also flips when the wishlist first loads; that must stay silent.)
  const clicked = useRef(false);
  const prevSaved = useRef(saved);
  useEffect(() => {
    if (savePending) return;
    if (clicked.current && saved !== prevSaved.current) {
      flash(saved ? 'Saved to wishlist' : 'Removed from wishlist');
      if (saved) {
        setPop(true);
        clearTimeout(popTimer.current);
        popTimer.current = setTimeout(() => setPop(false), 600);
      }
    }
    clicked.current = false;
    prevSaved.current = saved;
  }, [saved, savePending, flash]);

  const handleSave = useCallback(() => {
    clicked.current = true;
    onToggleSave(tour.id);
  }, [onToggleSave, tour.id]);

  const handleShare = useCallback(async () => {
    const url = new URL(`/tours/${tour.slug}`, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title: tour.title, text: tour.teaser ?? undefined, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // user closed the share sheet
        // Any other failure: fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copied');
    } catch {
      flash('Couldn’t copy link');
    }
  }, [tour.slug, tour.title, tour.teaser, flash]);

  const closeQuick = useCallback(() => setQuickOpen(false), []);

  const compareBlocked = compareDisabled && !compared;
  const showImage = tour.cover_url && imgState !== 'error';

  return (
    <article
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="group relative isolate aspect-[6/5] overflow-hidden rounded-3xl bg-ink-900 text-white shadow-md ring-1 ring-black/5 transition duration-300 motion-safe:hover:-translate-y-1 hover:shadow-2xl dark:ring-white/10"
    >
      {/* ------------------------------------------------------------ photo */}
      <div
        ref={mediaRef}
        className="absolute -inset-4 transition-transform duration-300 ease-out"
        aria-hidden="true"
      >
        {showImage ? (
          <>
            {imgState === 'loading' && (
              <div className="absolute inset-0 animate-pulse bg-ink-700 motion-reduce:animate-none" />
            )}
            <img
              ref={imgRef}
              src={tour.cover_url}
              alt=""
              loading="lazy"
              decoding="async"
              onLoad={() => setImgState('loaded')}
              onError={() => setImgState('error')}
              className={`h-full w-full object-cover transition duration-700 ease-out motion-safe:group-hover:scale-110 ${
                imgState === 'loaded' ? 'opacity-100' : 'opacity-0 motion-safe:blur-md'
              }`}
            />
          </>
        ) : (
          <NoPhoto title={tour.title} />
        )}
      </div>

      {/* Whole card opens the tour; every control below sits above this. */}
      <Link
        to={`/tours/${tour.slug}`}
        state={{ discount }}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 z-[1]"
      />

      {/* Readability: darkens the top (controls) and bottom (text). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/85 via-black/15 to-black/35 transition-opacity duration-300 group-hover:from-black/90"
      />

      {/* ----------------------------------------------------- top: badge + dock */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 p-3 sm:p-4">
        <div className="flex flex-col items-start gap-2">
          {discount && (
            <>
              <span className="rounded-full bg-glow px-3 py-1 text-xs font-black tracking-wide text-ink-900 shadow-lg">
                {discount.percent}% OFF
              </span>
              {/* The campaign name is a quiet second line, tablet and up: on a phone the
                  badge + the four controls already fill the row. */}
              <span className="hidden max-w-[12rem] truncate rounded-full bg-black/35 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/90 backdrop-blur-md sm:inline-block">
                {discount.label}
              </span>
            </>
          )}
        </div>

        <div className="pointer-events-auto ml-auto flex gap-2">
          {onToggleSave && (
            <DockButton
              label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
              tip={saved ? 'Saved' : 'Save'}
              onClick={handleSave}
              pressed={saved}
              busy={savePending}
              disabled={savePending}
              active={saved}
            >
              {pop && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-rose-400/50 motion-safe:animate-ping"
                />
              )}
              <HeartIcon
                filled={saved}
                className={`relative h-5 w-5 transition-transform duration-300 ${
                  saved ? 'text-rose-500 motion-safe:scale-110' : ''
                }`}
              />
            </DockButton>
          )}
          <DockButton label={`Share ${tour.title}`} tip="Share" onClick={handleShare}>
            <ShareIcon className="h-4 w-4" />
          </DockButton>
          {onToggleCompare && (
            <DockButton
              label={compared ? 'Remove from comparison' : 'Add to comparison'}
              tip={compareBlocked ? 'Compare limit: 3' : compared ? 'Comparing' : 'Compare'}
              onClick={() => onToggleCompare(tour)}
              pressed={compared}
              disabled={compareBlocked}
              active={compared}
            >
              <CompareIcon checked={compared} className="h-4 w-4" />
            </DockButton>
          )}
          <DockButton label={`Quick view of ${tour.title}`} tip="Quick view" onClick={() => setQuickOpen(true)}>
            <ExpandIcon className="h-4 w-4" />
          </DockButton>
        </div>

        {toast && (
          <span
            role="status"
            className="pointer-events-none absolute right-3 top-[3.75rem] rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-900 shadow-lg sm:right-4 md:top-16"
          >
            {toast}
          </span>
        )}
      </div>

      {/* ---------------------------------------------------------- bottom text */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-5 sm:p-6">
        {type && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">{type}</p>
        )}

        <h3 className="mt-1.5 line-clamp-2 text-xl font-bold leading-tight sm:text-2xl">
          <Link
            to={`/tours/${tour.slug}`}
            state={{ discount }}
            className="pointer-events-auto hover:underline"
          >
            {tour.title}
          </Link>
        </h3>

        {/* One teaser line on a sale card: the savings line needs the room, and the card
            keeps its fixed ratio so nothing around it moves. */}
        {tour.teaser && (
          <p
            className={`mt-2 text-sm leading-relaxed text-white/80 ${
              discount ? 'line-clamp-1' : 'line-clamp-2'
            }`}
          >
            {tour.teaser}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 text-sm text-white/90">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {rating ? (
              <span aria-label={`Rated ${rating.toFixed(1)} out of 5, ${tour.review_count ?? 0} reviews`}>
                <span className="text-glow">★</span> <strong>{rating.toFixed(1)}</strong>{' '}
                <span className="text-white/65">({tour.review_count ?? 0})</span>
              </span>
            ) : (
              <span className="text-white/70">New</span>
            )}
            {duration && (
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="h-3.5 w-3.5 text-white/70" />
                {duration}
              </span>
            )}
          </p>

          {/* Touch: tap to open the facts panel. Desktop opens it on hover / focus. */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={peekId}
            className="pointer-events-auto inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white/15 px-3 text-xs font-semibold backdrop-blur-md transition hover:bg-white/25 md:hidden"
          >
            {expanded ? 'Less' : 'Details'}
            <ChevronIcon
              className={`h-3.5 w-3.5 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Facts panel: grows upward inside the fixed-ratio card, so no layout shift. */}
        <div
          id={peekId}
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out md:group-focus-within:grid-rows-[1fr] md:group-focus-within:opacity-100 md:group-hover:grid-rows-[1fr] md:group-hover:opacity-100 ${
            expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <div className="pt-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-white/10 p-3 text-xs backdrop-blur-md">
                {type && (
                  <div>
                    <dt className="text-white/60">Type</dt>
                    <dd className="font-semibold capitalize">{type}</dd>
                  </div>
                )}
                {duration && (
                  <div>
                    <dt className="text-white/60">Duration</dt>
                    <dd className="font-semibold">{duration}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-white/60">Rating</dt>
                  <dd className="font-semibold">
                    {rating
                      ? `${rating.toFixed(1)} · ${tour.review_count ?? 0} review${
                          Number(tour.review_count) === 1 ? '' : 's'
                        }`
                      : 'No reviews yet'}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/60">Price per seat</dt>
                  <dd className="font-semibold">
                    {inr(tour.base_price)}
                    {hasPriceRange(tour) && ` – ${inr(tour.max_price)}`}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <OverlayPrice tour={tour} discount={discount} />
          <Link
            to={`/tours/${tour.slug}`}
            state={{ discount }}
            aria-label={discount ? `Book now: ${tour.title}` : `Explore trip: ${tour.title}`}
            title={discount ? 'Book now' : 'Explore trip'}
            className={`group/cta pointer-events-auto shrink-0 bg-white text-ink-900 shadow-lg transition duration-300 motion-safe:active:scale-95 ${
              discount
                ? 'inline-flex h-12 items-center gap-2 rounded-full pl-5 pr-4 text-sm font-bold hover:bg-glow motion-safe:hover:scale-105'
                : 'grid h-12 w-12 place-items-center rounded-full hover:bg-sand-100 motion-safe:hover:scale-110'
            }`}
          >
            {discount && <span>Book now</span>}
            <ArrowIcon
              className={`transition-transform duration-300 group-hover/cta:translate-x-0.5 ${
                discount ? 'h-4 w-4' : 'h-5 w-5'
              }`}
            />
          </Link>
        </div>
      </div>

      {quickOpen && <TourQuickView tour={tour} discount={discount} onClose={closeQuick} />}
    </article>
  );
}

export default memo(TourCard);