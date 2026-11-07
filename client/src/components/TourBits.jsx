import { inr } from '../lib/format.js';

/* Small shared helpers + icons for the tour card, quick view and skeleton. */

export const formatTourType = (type) => String(type ?? '').toLowerCase().replace(/_/g, ' ');

/** Real rating only: null when the API sends nothing, 0 or garbage. */
export function ratingOf(tour) {
  const n = Number(tour.avg_rating);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "3 Days / 2 Nights" from the fields the list API already returns. */
export function durationLabel(tour) {
  const d = Number(tour.duration_days);
  if (!d) return null;
  const days = `${d} ${d === 1 ? 'Day' : 'Days'}`;
  if (tour.duration_nights == null) return days;
  const n = Number(tour.duration_nights);
  return `${days} / ${n} ${n === 1 ? 'Night' : 'Nights'}`;
}

export const hasPriceRange = (tour) => Number(tour.max_price) > Number(tour.base_price);

/**
 * Price block. Display only: `discount` is whatever discountFor() produced in
 * Home.jsx, and nothing here recomputes or alters a price.
 */
export function TourPrice({ tour, discount }) {
  if (discount) {
    return (
      <p>
        <span className="text-lg font-bold text-green-700 dark:text-green-400">
          {inr(discount.discounted)}
        </span>
        <span className="text-xs text-sand-500 dark:text-sand-400"> /seat</span>{' '}
        <span className="text-xs text-sand-500 line-through dark:text-sand-400">
          {inr(discount.original)}
        </span>
        <span className="block text-[11px] font-semibold text-glow">
          {discount.percent}% off · {discount.label}
        </span>
      </p>
    );
  }
  return (
    <p>
      <span className="text-[11px] uppercase tracking-wider text-sand-500 dark:text-sand-400">
        From{' '}
      </span>
      <span className="text-lg font-bold">{inr(tour.base_price)}</span>
      <span className="text-xs text-sand-500 dark:text-sand-400"> /seat</span>
      {hasPriceRange(tour) && (
        <span className="block text-[11px] text-sand-500 dark:text-sand-400">
          up to {inr(tour.max_price)} fully loaded
        </span>
      )}
    </p>
  );
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const HeartIcon = ({ filled, className }) => (
  <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 21s-7.5-4.6-9.4-9.2C1.1 8.3 3 5 6.3 5c2 0 3.4 1.1 5.7 3.4C14.3 6.1 15.7 5 17.7 5 21 5 22.9 8.3 21.4 11.8 19.5 16.4 12 21 12 21Z" />
  </svg>
);

export const ShareIcon = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
  </svg>
);

export const ArrowIcon = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ChevronIcon = ({ className }) => (
  <svg {...base} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const PinIcon = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const CloseIcon = ({ className }) => (
  <svg {...base} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** Shown when a tour has no cover image, or the image fails to load. */
export function CoverFallback({ title }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-sand-100 to-sand-300 text-ink-700 dark:from-ink-800 dark:to-ink-700 dark:text-sand-300"
    >
      <PinIcon className="h-9 w-9 opacity-60" />
      <span className="line-clamp-1 max-w-[80%] text-xs font-medium opacity-70">{title}</span>
    </div>
  );
}