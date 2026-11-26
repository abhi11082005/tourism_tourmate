/*
 * Pure sorting / filtering for Explore. Nothing here touches the network or React.
 *
 * Rules (from the brief): a missing rating is "unknown" — it sorts after every known
 * rating and is excluded by a minimum-rating filter, never treated as 0 or 5.
 * Curated TourMate places carry no Google data, so Google-only filters (rating, open
 * now, price) never hide them.
 */

export const SORTS = [
  { id: 'nearest', label: 'Nearest' },
  { id: 'farthest', label: 'Farthest' },
  { id: 'rating_desc', label: 'Highest rated' },
  { id: 'rating_asc', label: 'Lowest rated' },
  { id: 'reviews_desc', label: 'Most reviewed' },
];

export const DEFAULT_FILTERS = { minRating: 0, openNow: false, maxPrice: null };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (p) => (isNum(p.straightLineMeters) ? p.straightLineMeters : null);

/** Compare with `null` (unknown) always last, regardless of direction. */
const byKnown = (get, dir) => (a, b) => {
  const x = get(a);
  const y = get(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return dir === 'asc' ? x - y : y - x;
};

const tieBreak = (a, b) => (dist(a) ?? Infinity) - (dist(b) ?? Infinity) || String(a.name).localeCompare(String(b.name));

export function sortPlaces(places, sortId = 'nearest') {
  const cmp = {
    nearest: byKnown(dist, 'asc'),
    farthest: byKnown(dist, 'desc'),
    rating_desc: byKnown((p) => p.rating, 'desc'),
    rating_asc: byKnown((p) => p.rating, 'asc'),
    reviews_desc: byKnown((p) => p.ratingCount, 'desc'),
  }[sortId] ?? byKnown(dist, 'asc');
  return [...places].sort((a, b) => cmp(a, b) || tieBreak(a, b));
}

/**
 * @returns {{ places: object[], hiddenUnrated: number }}
 */
export function filterPlaces(places, { radiusMeters, minRating = 0, openNow = false, maxPrice = null } = {}) {
  let hiddenUnrated = 0;
  const out = places.filter((p) => {
    const d = dist(p);
    if (radiusMeters != null && d != null && d > radiusMeters) return false;
    if (p.source !== 'google') return true; // curated: no Google fields to filter on
    if (minRating > 0) {
      if (!isNum(p.rating)) { hiddenUnrated += 1; return false; }
      if (p.rating < minRating) return false;
    }
    if (openNow && p.openNow !== true) return false; // unknown hours are not "open"
    if (maxPrice != null && isNum(p.priceLevel) && p.priceLevel > maxPrice) return false;
    return true;
  });
  return { places: out, hiddenUnrated };
}

/** Curated first when both exist at (almost) the same place is handled server-side; here just concat. */
export function mergePlaces(curated, google) {
  const seen = new Set();
  return [...curated, ...google].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

export const activeFilterCount = (f) =>
  (f.minRating > 0 ? 1 : 0) + (f.openNow ? 1 : 0) + (f.maxPrice != null ? 1 : 0);
