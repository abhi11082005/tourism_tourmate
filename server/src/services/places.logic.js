/*
 * Pure helpers for Google Places discovery: no I/O, no env, so they unit-test
 * without a database or a key.
 *
 * WHY THE CATEGORY RULES LOOK THE WAY THEY DO
 *
 * Places API (New) splits place types into two tables. Table A types may be sent in a
 * request (`includedTypes`); Table B types (place_of_worship, point_of_interest,
 * establishment, landmark, ...) are only ever *returned*. Sending one makes Google
 * answer 400 for the whole request. The temples category used to include
 * `place_of_worship`, which is exactly that, so selecting it failed outright.
 * `places.logic.test.js` now fails if any Table B type reappears in a request.
 *
 * A request type only says "return places that have this type", so every group also
 * carries an `accept` rule that is checked against the types Google *returned*.
 * That is what keeps a fort out of Famous Rides and a hotel out of Street Food.
 */

/** Response-only types. Never valid in `includedTypes`. Kept here so the guard test can import it. */
export const TABLE_B_RESPONSE_ONLY = [
  'administrative_area_level_3', 'administrative_area_level_4', 'administrative_area_level_5',
  'administrative_area_level_6', 'administrative_area_level_7', 'archipelago', 'colloquial_area',
  'continent', 'establishment', 'finance', 'food', 'general_contractor', 'geocode', 'health',
  'intersection', 'landmark', 'natural_feature', 'neighborhood', 'place_of_worship', 'plus_code',
  'point_of_interest', 'political', 'postal_code_prefix', 'postal_code_suffix', 'postal_town',
  'premise', 'route', 'street_address', 'sublocality', 'sublocality_level_1', 'sublocality_level_2',
  'sublocality_level_3', 'sublocality_level_4', 'sublocality_level_5', 'subpremise', 'town_square',
];

const NOT_TOURISM_PRIMARY = [
  'restaurant', 'cafe', 'coffee_shop', 'bakery', 'bar', 'lodging', 'hotel', 'resort_hotel',
  'guest_house', 'hostel', 'motel', 'store', 'shopping_mall', 'gas_station', 'parking',
];

const WORSHIP = ['hindu_temple', 'buddhist_temple', 'mosque', 'church', 'synagogue', 'shinto_shrine'];
const MONUMENTS = ['monument', 'historical_landmark', 'cultural_landmark'];

const RIDE_TYPES = [
  'amusement_park', 'water_park', 'ferris_wheel', 'roller_coaster', 'amusement_center',
  'go_karting_venue', 'adventure_sports_center',
];
// A ride has to be a ride *by name or by type*. "Popular" and "tourist_attraction" are not enough.
const RIDE_NAME =
  /ropeway|rope way|cable[\s-]?car|gondola|chair[\s-]?lift|zip[\s-]?line|boating|boat ride|pedal boat|toy train|safari|roller[\s-]?coaster|ferris|giant wheel|water ?park|amusement|adventure park|go[\s-]?kart|joy ?ride|elephant ride|camel ride|horse ride|paragliding|bungee|rafting/i;

const STREET_FOOD_NAME =
  /chaat|street|gol ?gappa|pani ?puri|kachori|samosa|jalebi|vada|thela|stall|dhaba|food (court|street|lane|market)|bazaar|bazar|halwai|sweets|lassi|kulfi|tikki|paratha/i;

const SHOPPING_NAME = /bazaar|bazar|market|mandi|haat|emporium|handicraft|mall|chowk|plaza|arcade/i;
const WORSHIP_NAME = /gurdwara|gurudwara|gurudwar|mandir|temple|masjid|dargah|church|mosque|math\b|ashram/i;

/*
 * `searches`: one Google call each. { types } → Nearby Search, { textQuery } → Text
 * Search. `fallbackTypes` is retried once if Google rejects the first list, so a
 * recently added type can never take a whole category down again.
 *
 * `accept` / `rejectPrimary` / `minRating` / `minReviews` run on what Google returned.
 */
export const PLACE_GROUPS = {
  attractions: {
    label: 'Attractions',
    kind: 'attraction',
    tourmate: 'MUST_VISIT',
    searches: [
      {
        types: ['tourist_attraction', 'historical_landmark', 'cultural_landmark', 'castle'],
        fallbackTypes: ['tourist_attraction', 'historical_landmark', 'cultural_landmark'],
      },
    ],
    accept: { types: ['tourist_attraction', 'historical_landmark', 'cultural_landmark', 'castle', 'historical_place'] },
    rejectPrimary: NOT_TOURISM_PRIMARY,
  },
  museums: {
    label: 'Museums',
    kind: 'museum',
    tourmate: 'MUST_VISIT',
    searches: [
      {
        types: ['museum', 'art_gallery', 'history_museum', 'art_museum'],
        fallbackTypes: ['museum', 'art_gallery'],
      },
    ],
    accept: { types: ['museum', 'art_gallery', 'history_museum', 'art_museum'] },
  },
  temples: {
    label: 'Temples & monuments',
    kind: 'temple',
    tourmate: 'MUST_VISIT',
    searches: [
      // Places of worship (Table A types only — `place_of_worship` is Table B).
      {
        types: ['hindu_temple', 'buddhist_temple', 'mosque', 'church', 'synagogue'],
        fallbackTypes: ['hindu_temple', 'mosque', 'church', 'synagogue'],
      },
      // Monuments are a separate call: one mixed call is capped at 20 results and the
      // most "popular" monuments would crowd the temples out.
      { types: MONUMENTS },
      // Google has no Sikh place-of-worship type, so gurudwaras come from a text query.
      { textQuery: 'gurudwara' },
    ],
    accept: { types: [...WORSHIP, ...MONUMENTS, 'place_of_worship', 'historical_place'], name: WORSHIP_NAME },
    rejectPrimary: ['restaurant', 'cafe', 'lodging', 'hotel', 'store'],
  },
  restaurants: {
    label: 'Restaurants',
    kind: 'restaurant',
    tourmate: 'MUST_EAT',
    searches: [{ types: ['restaurant'] }],
    accept: { types: ['restaurant', 'food_court', 'meal_takeaway'], suffix: ['_restaurant'] },
  },
  // "Must eat" on Google's side: restaurants that are verifiably well reviewed. The
  // thresholds are real data (rating and review count), not a guess at fame.
  popular_food: {
    label: 'Popular restaurants',
    kind: 'restaurant',
    tourmate: 'MUST_EAT',
    searches: [{ types: ['restaurant'] }],
    accept: { types: ['restaurant', 'food_court'], suffix: ['_restaurant'] },
    minRating: 4.0,
    minReviews: 100,
  },
  cafes: {
    label: 'Cafes',
    kind: 'cafe',
    tourmate: 'MUST_EAT',
    searches: [
      {
        types: ['cafe', 'coffee_shop', 'bakery', 'tea_house', 'coffee_roastery'],
        fallbackTypes: ['cafe', 'coffee_shop', 'bakery'],
      },
    ],
    accept: { types: ['cafe', 'coffee_shop', 'bakery', 'tea_house', 'coffee_roastery', 'coffee_stand'] },
    rejectPrimary: ['restaurant', 'bar', 'night_club', 'lodging', 'hotel'],
  },
  street_food: {
    label: 'Street food',
    kind: 'street_food',
    tourmate: 'MUST_EAT',
    searches: [{ textQuery: 'street food' }],
    accept: {
      types: [
        'snack_bar', 'meal_takeaway', 'food_court', 'fast_food_restaurant', 'juice_shop', 'ice_cream_shop',
        'dessert_shop', 'confectionery', 'coffee_stand', 'tea_house', 'hot_dog_stand', 'sandwich_shop',
        'candy_store', 'market',
      ],
      name: STREET_FOOD_NAME,
    },
    rejectPrimary: ['lodging', 'hotel', 'resort_hotel', 'guest_house', 'hostel'],
  },
  shopping: {
    label: 'Shopping',
    kind: 'shopping',
    tourmate: null,
    searches: [
      { types: ['shopping_mall', 'market'] },
      { textQuery: 'bazaar handicraft market' },
    ],
    accept: { types: ['shopping_mall', 'market', 'department_store'], name: SHOPPING_NAME },
    rejectPrimary: ['restaurant', 'cafe', 'lodging', 'hotel'],
  },
  // STRICT: only places that are, or run, an actual ride. Availability is never claimed.
  rides: {
    label: 'Rides & fun',
    kind: 'ride',
    tourmate: 'FAMOUS_RIDE',
    searches: [
      {
        types: RIDE_TYPES,
        fallbackTypes: ['amusement_park', 'water_park', 'amusement_center', 'adventure_sports_center'],
      },
      { textQuery: 'ropeway cable car' },
      { textQuery: 'boating toy train safari ride' },
    ],
    accept: { types: RIDE_TYPES, name: RIDE_NAME },
    rejectPrimary: ['restaurant', 'cafe', 'lodging', 'hotel', 'store', 'shopping_mall', 'parking'],
  },
  experiences: {
    label: 'Experiences',
    kind: 'experience',
    tourmate: null,
    searches: [
      {
        types: ['zoo', 'aquarium', 'botanical_garden', 'wildlife_park', 'national_park', 'city_park', 'park', 'planetarium', 'hiking_area', 'observation_deck'],
        fallbackTypes: ['zoo', 'aquarium', 'botanical_garden', 'wildlife_park', 'national_park', 'park', 'planetarium', 'hiking_area'],
      },
    ],
    accept: {
      types: ['zoo', 'aquarium', 'botanical_garden', 'wildlife_park', 'national_park', 'city_park', 'park', 'planetarium', 'hiking_area', 'observation_deck', 'garden'],
    },
    rejectPrimary: ['restaurant', 'cafe', 'lodging', 'hotel', 'store'],
  },
};

export const GROUP_KEYS = Object.keys(PLACE_GROUPS);

/** Every type any group sends to Google (including fallbacks). */
export const requestTypes = () => [
  ...new Set(
    Object.values(PLACE_GROUPS).flatMap((g) => g.searches.flatMap((s) => [...(s.types ?? []), ...(s.fallbackTypes ?? [])]))
  ),
];

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

/* ------------------------------------------------------------ relevance */

const nameOf = (raw) => raw?.displayName?.text ?? '';
const typesOf = (raw) => new Set([raw?.primaryType, ...(raw?.types ?? [])].filter(Boolean));

/**
 * Does a place Google returned really belong in this group? Runs on the raw Google
 * place so it can use the full `types` list, rating and review count.
 */
export function acceptsPlace(raw, groupKey) {
  const g = PLACE_GROUPS[groupKey];
  if (!g) return false;

  if (g.rejectPrimary?.includes(raw?.primaryType)) {
    // A temple or fort that is *also* a tourist attraction is not rejected by this list;
    // only places whose main identity is food / lodging / retail are.
    return false;
  }
  if (g.minRating != null && !(typeof raw?.rating === 'number' && raw.rating >= g.minRating)) return false;
  if (g.minReviews != null && !(typeof raw?.userRatingCount === 'number' && raw.userRatingCount >= g.minReviews)) {
    return false;
  }

  const a = g.accept;
  if (!a) return true;
  const t = typesOf(raw);
  if (a.types?.some((x) => t.has(x))) return true;
  if (a.suffix?.some((s) => [...t].some((x) => x.endsWith(s)))) return true;
  if (a.name?.test(nameOf(raw))) return true;
  return false;
}

/** What kind of ride, from the name and types. Only called for the rides group. */
export function rideTypeOf(raw) {
  const name = nameOf(raw);
  const t = typesOf(raw);
  if (/ropeway|rope way|cable[\s-]?car|gondola|chair[\s-]?lift/i.test(name)) return 'Ropeway / cable car';
  if (/toy train/i.test(name)) return 'Toy train';
  if (/boat|pedal/i.test(name)) return 'Boating';
  if (/safari/i.test(name)) return 'Safari';
  if (/zip[\s-]?line/i.test(name)) return 'Zip line';
  if (t.has('water_park') || /water ?park/i.test(name)) return 'Water park';
  if (t.has('amusement_park') || /amusement/i.test(name)) return 'Amusement park';
  if (t.has('roller_coaster') || t.has('ferris_wheel') || /roller|ferris|giant wheel/i.test(name)) return 'Fairground ride';
  if (t.has('go_karting_venue') || /go[\s-]?kart/i.test(name)) return 'Go-karting';
  if (t.has('adventure_sports_center') || /adventure|paragliding|bungee|rafting/i.test(name)) return 'Adventure activity';
  if (t.has('amusement_center')) return 'Amusement centre';
  return 'Ride';
}

/**
 * Kind for places that did not come from a category search (text search, details):
 * decided from Google's own types, never from the call that happened to find them.
 */
export function classifyKind(raw) {
  const t = typesOf(raw);
  const has = (...names) => names.some((n) => t.has(n));
  if (has(...WORSHIP) ) return 'temple';
  if (has('museum', 'art_gallery', 'history_museum', 'art_museum')) return 'museum';
  if (has('cafe', 'coffee_shop', 'bakery', 'tea_house')) return 'cafe';
  if ([...t].some((x) => x === 'restaurant' || x.endsWith('_restaurant')) || has('food_court', 'meal_takeaway')) return 'restaurant';
  if (has('shopping_mall', 'market')) return 'shopping';
  if (has(...RIDE_TYPES)) return 'ride';
  if (has('zoo', 'aquarium', 'botanical_garden', 'wildlife_park', 'national_park', 'park', 'city_park')) return 'experience';
  return 'attraction';
}

const PRICE = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

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
  const kind = group?.kind ?? classifyKind(raw);

  return {
    id: `g:${raw.id}`,
    source: 'google',
    placeId: raw.id,
    name: raw.displayName?.text ?? null,
    address: raw.formattedAddress ?? null,
    lat,
    lng,
    group: groupKey ?? null,
    groupLabel: group?.label ?? null,
    kind,
    primaryType: raw.primaryTypeDisplayName?.text ?? raw.primaryType ?? null,
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    ratingCount: typeof raw.userRatingCount === 'number' ? raw.userRatingCount : null,
    // 0 (free) … 4 (very expensive) exactly as Google reports it; absent stays null.
    priceLevel: raw.priceLevel in PRICE ? PRICE[raw.priceLevel] : null,
    // Only ever a real boolean from Google; undefined hours means "unknown".
    openNow: typeof openNow === 'boolean' ? openNow : null,
    businessStatus: raw.businessStatus ?? null,
    // Rides: what kind, and an explicit "we have not verified it is running".
    rideType: kind === 'ride' && groupKey === 'rides' ? rideTypeOf(raw) : null,
    availability: kind === 'ride' && groupKey === 'rides' ? 'unverified' : null,
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
