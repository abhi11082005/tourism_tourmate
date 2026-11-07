import { Bike, Car, Footprints, Leaf, Mountain, Utensils, Zap } from 'lucide-react';

/*
 * Values, labels and blurbs are exactly the ones Explore always used — the `value`s
 * are what the routing API receives. Only the icons are new.
 */
export const MOODS = [
  { value: 'scenic', label: 'Scenic', description: 'Prettiest way round', icon: Mountain },
  { value: 'quiet', label: 'Quiet', description: 'Away from traffic', icon: Leaf },
  { value: 'food', label: 'Food', description: 'Past the good stuff', icon: Utensils },
  { value: 'fastest', label: 'Fastest', description: 'Straight there', icon: Zap },
];

export const PROFILES = [
  { value: 'foot', label: 'Walk', icon: Footprints },
  { value: 'bike', label: 'Cycle', icon: Bike },
  { value: 'car', label: 'Drive', icon: Car },
];

// Same palette MapCanvas paints its pins with, so a card and its pin read as one.
export const CATEGORIES = {
  MUST_VISIT: { label: 'Must visit', color: '#3b5bdb' },
  MUST_EAT: { label: 'Must eat', color: '#e8590c' },
  FAMOUS_RIDE: { label: 'Famous ride', color: '#0ca678' },
};

export const categoryLabel = (category) =>
  CATEGORIES[category]?.label ?? String(category ?? '').toLowerCase().replace(/_/g, ' ');

export const categoryColor = (category) => CATEGORIES[category]?.color ?? '#868e96';

// Straight-line distance between two {lat,lng} points. Display only — it is labelled
// "straight line" wherever shown and never stands in for the routed distance.
export function straightLineKm(a, b) {
  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const formatStraightKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

// Shared surface styles. Full literal strings so Tailwind can see every class.
export const GLASS =
  'border border-white/70 bg-white/85 shadow-[0_18px_50px_-18px_rgba(18,20,31,0.35)] backdrop-blur-xl ' +
  'dark:border-ink-600/70 dark:bg-ink-900/85';

export const GLASS_PILL =
  'border border-white/70 bg-white/90 shadow-lg backdrop-blur-md dark:border-ink-600/70 dark:bg-ink-900/90';

export const SECTION_LABEL = 'text-[11px] font-bold uppercase tracking-[0.14em] faint';
