/*
 * Pure helpers for Google Places discovery: no I/O, no env, so they unit-test
 * without a database or a key.
 */

/**
 * Discovery groups. `types` are Places API (New) "Table A" type names; a group with
 * `textQuery` goes through Text Search instead because Google has no type for it
 * (street food). `tourmate` is the curated category a group lines up with, or null
 * when it has no honest equivalent — a Google result is never *labelled* with a
 * TourMate category, the client only uses this to decide which chips show it.
 */
export const PLACE_GROUPS = {
  attractions: {
    label: 'Attractions',
    types: ['tourist_attraction', 'historical_landmark', 'cultural_landmark', 'monument'],
    tourmate: 'MUST_VISIT',
    kind: 'attraction',
  },
  museums: {
    label: 'Museums',
    types: ['museum', 'art_gallery'],
    tourmate: 'MUST_VISIT',
    kind: 'attraction',
  },
  temples: {
    label: 'Temples & monuments',
    types: ['hindu_temple', 'place_of_worship', 'monument', 'historical_landmark'],
    tourmate: 'MUST_VISIT',
    kind: 'attraction',
  },
  restaurants: {
    label: 'Restaurants',
    types: ['restaurant'],
    tourmate: 'MUST_EAT',
    kind: 'restaurant',
  },
  cafes: {
    label: 'Cafes',
    types: ['cafe', 'coffee_shop', 'bakery'],
    tourmate: 'MUST_EAT',
    kind: 'restaurant',
  },
  street_food: {
    label: 'Street food',
    textQuery: 'street food',
    tourmate: 'MUST_EAT',
    kind: 'restaurant',
  },
  shopping: {
    label: 'Shopping',
    types: ['shopping_mall', 'market'],
    tourmate: null,
    kind: 'attraction',
  },
  rides: {
    label: 'Rides & fun',
    types: ['amusement_park', 'water_park', 'amusement_center', 'adventure_sports_center'],
    tourmate: 'FAMOUS_RIDE',
    kind: 'attraction',
  },
  experiences: {
    label: 'Experiences',
    types: ['zoo', 'aquarium', 'park'],
    tourmate: null,
    kind: 'attraction',
  },
};

export const GROUP_KEYS = Object.keys(PLACE_GROUPS);

const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. Straight-line only — never a road distance. */
export function haversineMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "123s" / "123.4s" (protobuf Duration as JSON) → whole seconds, or null. */
export function parseDuration(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return m ? Math.round(Number(m[1])) : null;
}

/**
 * Google Place → the stable shape the client consumes. Only fields we asked for in
 * the field mask can be present, and anything absent stays `null` — a missing
 * rating is never defaulted to a number.
 */
export function normalizePlace(raw, groupKey, center) {
  const lat = raw?.location?.latitude;
  const lng = raw?.location?.longitude;
  if (!raw?.id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const group = PLACE_GROUPS[groupKey];
  const photo = raw.photos?.[0];
  const openNow = raw.currentOpeningHours?.openNow;

  return {
    id: `g:${raw.id}`,
    source: 'google',
    placeId: raw.id,
    name: raw.displayName?.text ?? null,
    address: raw.formattedAddress ?? null,
    lat,
    lng,
    group: groupKey,
    groupLabel: group?.label ?? null,
    kind: group?.kind ?? 'attraction',
    primaryType: raw.primaryTypeDisplayName?.text ?? raw.primaryType ?? null,
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    ratingCount: typeof raw.userRatingCount === 'number' ? raw.userRatingCount : null,
    // Only ever a real boolean from Google; undefined hours means "unknown".
    openNow: typeof openNow === 'boolean' ? openNow : null,
    businessStatus: raw.businessStatus ?? null,
    photo: photo?.name
      ? {
          name: photo.name,
          attributions: (photo.authorAttributions ?? []).map((a) => ({
            name: a.displayName ?? null,
            uri: a.uri ?? null,
          })),
        }
      : null,
    straightLineMeters: center ? Math.round(haversineMeters(center, { lat, lng })) : null,
  };
}

/** Lower-case, de-accented, alphanumeric tokens with filler words removed. */
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'restaurant', 'cafe', 'hotel']);
export function nameTokens(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t));
}

export function nameSimilarity(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared); // Jaccard
}

/**
 * Same physical place? Needs both a close position and a matching name — position
 * alone would merge a fort with the chai stall at its gate, and a name alone would
 * merge two branches of a chain. The DB has no Place ID column, so this is the
 * verified coordinate + name match the brief asks for.
 */
export function isSamePlace(curated, google) {
  const d = haversineMeters(curated, google);
  if (d > 150) return false;
  const sim = nameSimilarity(curated.name, google.name);
  if (sim >= 0.6) return true;
  const na = nameTokens(curated.name).join(' ');
  const nb = nameTokens(google.name).join(' ');
  const contains = na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na));
  return (contains && d <= 150) || (sim >= 0.34 && d <= 40);
}

/**
 * Drop Google results that duplicate a curated attraction (curated wins, since it
 * carries our own description and category) and repeats of the same Place ID that
 * arrive through two groups.
 */
export function dedupePlaces(googlePlaces, curated = []) {
  const seen = new Set();
  const kept = [];
  let droppedAsCurated = 0;
  for (const place of googlePlaces) {
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    if (curated.some((c) => isSamePlace(c, place))) {
      droppedAsCurated += 1;
      continue;
    }
    kept.push(place);
  }
  return { places: kept, droppedAsCurated };
}
