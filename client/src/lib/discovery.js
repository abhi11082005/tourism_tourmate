import { api } from './api.js';
import { CATEGORY_STYLE } from './mapMarkers.js';
import { km, minutes } from './format.js';

/*
 * Explore's discovery model: one list of "places" that mixes TourMate's curated
 * attractions with Google Places discoveries, with the source always kept explicit.
 */

export const RADII = [1000, 5000, 10000, 20000];
export const DEFAULT_RADIUS = 5000;
export const radiusLabel = (m) => `${m / 1000} km`;

/**
 * Filter chips. The first three are TourMate's own categories and keep their
 * database names; `curated` is the TourMate category a chip selects, `groups` are the
 * Google Places groups (see server places.logic.js PLACE_GROUPS) it adds on top.
 */
export const CHIPS = [
  { id: 'MUST_VISIT', label: 'Must visit', color: CATEGORY_STYLE.MUST_VISIT.color, curated: 'MUST_VISIT', groups: ['attractions'] },
  { id: 'MUST_EAT', label: 'Must eat', color: CATEGORY_STYLE.MUST_EAT.color, curated: 'MUST_EAT', groups: ['street_food', 'restaurants'] },
  { id: 'FAMOUS_RIDE', label: 'Famous rides', color: CATEGORY_STYLE.FAMOUS_RIDE.color, curated: 'FAMOUS_RIDE', groups: ['rides'] },
  { id: 'restaurants', label: 'Restaurants', color: '#c2255c', groups: ['restaurants'] },
  { id: 'cafes', label: 'Cafes', color: '#c2255c', groups: ['cafes'] },
  { id: 'street_food', label: 'Street food', color: '#c2255c', groups: ['street_food'] },
  { id: 'shopping', label: 'Shopping', color: '#7048e8', groups: ['shopping'] },
  { id: 'museums', label: 'Museums', color: '#7048e8', groups: ['museums'] },
  { id: 'temples', label: 'Temples & monuments', color: '#7048e8', groups: ['temples'] },
  { id: 'experiences', label: 'Experiences', color: '#7048e8', groups: ['experiences'] },
];

// What "All" (no chip selected) asks Google for: three calls, not nine.
export const DEFAULT_GROUPS = ['attractions', 'restaurants', 'cafes'];
export const MAX_GROUPS = 6; // matches the server's limit per request

/** Which Google groups and which curated categories a chip selection means. */
export function resolveSelection(selected) {
  if (!selected.length) return { groups: DEFAULT_GROUPS, curated: null, truncated: false };
  const chips = CHIPS.filter((c) => selected.includes(c.id));
  const groups = [...new Set(chips.flatMap((c) => c.groups))];
  return {
    groups: groups.slice(0, MAX_GROUPS),
    // With chips chosen, a curated place shows only if its own category was chosen.
    curated: new Set(chips.map((c) => c.curated).filter(Boolean)),
    truncated: groups.length > MAX_GROUPS,
  };
}

/* ----------------------------------------------------------- normalisation */

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Curated attraction → place. Accepts a `/attractions/nearby` item (snake_case, with
 * `distance_m`), or a flattened viewport pin. Fields that the source does not carry
 * stay null — a curated place has no rating or opening hours in our database.
 */
export function curatedToPlace(a) {
  return {
    id: String(a.id),
    source: 'tourmate',
    placeId: null,
    name: a.name,
    lat: Number(a.lat),
    lng: Number(a.lng),
    kind: a.category,
    category: a.category,
    label: CATEGORY_STYLE[a.category]?.label ?? 'Place',
    description: a.description ?? null,
    city: a.city ?? null,
    imageUrl: a.image_url ?? a.imageUrl ?? null,
    address: null,
    rating: null,
    ratingCount: null,
    openNow: null,
    visitMinutes: a.avg_visit_min ?? a.visitMinutes ?? null,
    // From PostGIS ST_Distance on the geography type, rounded to metres.
    straightLineMeters: num(a.distance_m),
  };
}

/** Google place (server-normalised) → place. `kind` picks the marker style. */
export function googleToPlace(p) {
  return {
    id: p.id,
    source: 'google',
    placeId: p.placeId,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    kind: p.kind,
    category: null,
    label: p.primaryType ?? p.groupLabel ?? 'Place',
    description: null,
    city: null,
    imageUrl: null,
    photo: p.photo ?? null,
    address: p.address ?? null,
    rating: p.rating ?? null,
    ratingCount: p.ratingCount ?? null,
    openNow: p.openNow ?? null,
    straightLineMeters: p.straightLineMeters ?? null,
  };
}

/** Image URL for a card: our own curated image, else a Google photo via our proxy. */
export const placeImage = (place, width = 480) =>
  place.imageUrl ?? (place.photo?.name ? api.placePhotoUrl(place.photo.name, width) : null);

/* ---------------------------------------------------------------- labels */

/** "450 m away" — straight-line only. Never describes a road distance. */
export const straightLabel = (place) =>
  place.straightLineMeters != null ? `${km(place.straightLineMeters)} away` : null;

const MODE_WORD = { walk: 'walk', drive: 'drive', bicycle: 'ride' };

/** "650 m · 9 min walk" — only from a real Routes API result. */
export const travelLabel = (travel, mode) =>
  travel?.distanceMeters != null && travel?.durationSeconds != null
    ? `${km(travel.distanceMeters)} · ${minutes(travel.durationSeconds)} ${MODE_WORD[mode] ?? ''}`.trim()
    : null;

export const TRAVEL_MODES = [
  ['walk', 'Walk'],
  ['bicycle', 'Cycle'],
  ['drive', 'Drive'],
];

/**
 * Google Maps URLs API deep link — opens turn-by-turn navigation in the Maps app or
 * site. We never claim to navigate in the page itself. `origin` is omitted when we
 * only have an approximate position, so Google uses the device's real location
 * instead of a guess of ours.
 */
export function googleDirectionsUrl({ origin, destination, mode = 'walk' }) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: { walk: 'walking', drive: 'driving', bicycle: 'bicycling' }[mode] ?? 'walking',
  });
  if (destination.placeId) params.set('destination_place_id', destination.placeId);
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export const ratingLabel = (p) =>
  p.rating != null ? `${p.rating.toFixed(1)}${p.ratingCount != null ? ` (${p.ratingCount.toLocaleString('en-IN')})` : ''}` : null;

/** Round a coordinate for use in a React Query key, so a GPS jitter is not a new query. */
export const round = (n, dp = 3) => Number(Number(n).toFixed(dp));

const EARTH_M = 6_371_000;
const toRad = (d) => (d * Math.PI) / 180;

/**
 * Great-circle (straight-line) distance in metres. Used only for places that did not
 * come with a PostGIS / server distance — e.g. pins loaded for the visible viewport.
 * It is a straight line and is only ever shown as "… away", never as a road distance.
 */
export function straightMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h))));
}
