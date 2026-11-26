import { cached, googleFetch, PLACES_API, ROUTES_API } from './google.service.js';
import { findNearby } from './attractions.service.js';
import { HttpError } from '../utils/httpError.js';
import {
  PLACE_GROUPS,
  acceptsPlace,
  dedupePlaces,
  normalizePlace,
  parseDuration,
  haversineMeters,
} from './places.logic.js';

/*
 * Places API (New) discovery, Place Details, photos and Route Matrix.
 *
 * Field masks list exactly what the UI renders. Each extra field can move a call
 * into a pricier SKU, so adding one here is a cost decision, not a convenience.
 */

// Nearby / Text Search: card-level data only. No reviews, no phone, no website.
const SEARCH_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.priceLevel',
  'places.businessStatus',
  'places.currentOpeningHours.openNow',
  'places.photos.name',
  'places.photos.authorAttributions',
].join(',');

// Details are fetched once, when someone opens a place — never for list rendering.
const DETAILS_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'primaryType',
  'primaryTypeDisplayName',
  'types',
  'priceLevel',
  'businessStatus',
  'editorialSummary',
  'regularOpeningHours.weekdayDescriptions',
  'currentOpeningHours.openNow',
  'googleMapsUri',
  'websiteUri',
  'photos.name',
  'photos.authorAttributions',
].join(',');

// Ask for 20 (Nearby Search's cap) so post-filtering still leaves a useful list, then keep 12.
const FETCH_COUNT = 20;
const PER_GROUP = 12;

const round = (n, dp = 3) => Number(n.toFixed(dp));

/* ---------------------------------------------------------------- nearby */

async function runSearch({ search, center, radiusMeters, signal }) {
  const circle = { center: { latitude: center.lat, longitude: center.lng }, radius: radiusMeters };

  // Cache on a ~110 m grid: two visitors a few steps apart share one Google call.
  const what = search.textQuery ? `t:${search.textQuery}` : `n:${search.types.join('+')}`;
  const key = `nearby:${what}:${round(center.lat)}:${round(center.lng)}:${radiusMeters}`;

  return cached(
    key,
    async (innerSignal) => {
      if (search.textQuery) {
        const res = await googleFetch(`${PLACES_API}/places:searchText`, {
          fieldMask: SEARCH_MASK,
          signal: innerSignal,
          body: {
            textQuery: search.textQuery,
            maxResultCount: FETCH_COUNT,
            // Text Search only biases; the real cut-off is applied after.
            locationBias: { circle },
            rankPreference: 'RELEVANCE',
          },
        });
        return res.places ?? [];
      }
      const call = (types) =>
        googleFetch(`${PLACES_API}/places:searchNearby`, {
          fieldMask: SEARCH_MASK,
          signal: innerSignal,
          body: {
            includedTypes: types,
            maxResultCount: FETCH_COUNT,
            rankPreference: 'POPULARITY',
            locationRestriction: { circle },
          },
        });
      try {
        return (await call(search.types)).places ?? [];
      } catch (err) {
        // A type list Google rejects must not take the whole category down: retry
        // once with the conservative list. Other errors (auth, quota) propagate.
        if (err?.code === 'GOOGLE_BAD_REQUEST' && search.fallbackTypes) {
          return (await call(search.fallbackTypes)).places ?? [];
        }
        throw err;
      }
    },
    { signal }
  );
}

async function searchGroup({ groupKey, center, radiusMeters, signal }) {
  const group = PLACE_GROUPS[groupKey];

  const settled = await Promise.allSettled(
    group.searches.map((search) => runSearch({ search, center, radiusMeters, signal }))
  );
  // A category only fails when every one of its searches failed.
  if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;

  const seen = new Set();
  const out = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const raw of s.value) {
      if (!raw?.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      if (!acceptsPlace(raw, groupKey)) continue;
      const p = normalizePlace(raw, groupKey, center);
      if (p && p.name && p.straightLineMeters <= radiusMeters && p.businessStatus !== 'CLOSED_PERMANENTLY') {
        out.push(p);
      }
    }
  }
  out.sort((a, b) => a.straightLineMeters - b.straightLineMeters);
  return out.slice(0, PER_GROUP);
}

/**
 * External discoveries around a point, de-duplicated against TourMate's own
 * attractions (which win). Groups are searched in parallel; if some fail the rest
 * still return, and `failedGroups` says which.
 */
export async function nearbyPlaces({ lat, lng, radiusMeters, groups, signal, loadCurated = findNearby }) {
  const center = { lat, lng };

  const settled = await Promise.allSettled(
    groups.map((groupKey) => searchGroup({ groupKey, center, radiusMeters, signal }))
  );

  // Nothing worked: surface the first real error instead of an empty "no results".
  if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;

  const failedGroups = groups.filter((_, i) => settled[i].status === 'rejected');
  const merged = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));

  const curated = await loadCurated({ lat, lng, radiusMeters, limit: 100 });
  const { places, droppedAsCurated } = dedupePlaces(merged, curated);

  places.sort((a, b) => a.straightLineMeters - b.straightLineMeters);

  return { items: places, droppedAsCurated, failedGroups };
}

/** Free-text search near a point — runs only when someone presses Enter. */
export async function searchPlaces({ query, lat, lng, signal }) {
  const key = `search:${query.toLowerCase()}:${round(lat, 2)}:${round(lng, 2)}`;
  const raw = await cached(
    key,
    async (innerSignal) => {
      const res = await googleFetch(`${PLACES_API}/places:searchText`, {
        fieldMask: SEARCH_MASK,
        signal: innerSignal,
        body: {
          textQuery: query,
          maxResultCount: 10,
          locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 30_000 } },
        },
      });
      return res.places ?? [];
    },
    { signal }
  );
  const center = { lat, lng };
  return raw.map((p) => normalizePlace(p, 'attractions', center)).filter((p) => p?.name);
}

/* --------------------------------------------------------------- details */

export async function placeDetails({ placeId, signal }) {
  const raw = await cached(
    `details:${placeId}`,
    (innerSignal) =>
      googleFetch(`${PLACES_API}/places/${encodeURIComponent(placeId)}`, {
        method: 'GET',
        fieldMask: DETAILS_MASK,
        timeoutMs: 6_000,
        signal: innerSignal,
      }),
    { signal }
  );

  const base = normalizePlace(raw, null, null);
  if (!base) throw new HttpError(502, 'Google returned an unusable place', { code: 'GOOGLE_ERROR' });

  return {
    ...base,
    summary: raw.editorialSummary?.text ?? null,
    // Only present when Google actually has hours for the place.
    weekdayHours: raw.regularOpeningHours?.weekdayDescriptions ?? null,
    googleMapsUri: raw.googleMapsUri ?? null,
    websiteUri: raw.websiteUri ?? null,
    photos: (raw.photos ?? []).slice(0, 6).map((p) => ({
      name: p.name,
      attributions: (p.authorAttributions ?? []).map((a) => ({ name: a.displayName ?? null, uri: a.uri ?? null })),
    })),
  };
}

/**
 * Photo media needs the API key, which must not reach the browser. Ask Google for a
 * short-lived keyless image URL (skipHttpRedirect) and let the browser fetch the
 * bytes from Google directly — we never proxy image traffic.
 */
export async function photoUrl({ name, maxWidthPx, signal }) {
  const res = await googleFetch(
    `${PLACES_API}/${name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`,
    { method: 'GET', timeoutMs: 5_000, signal }
  );
  if (!res.photoUri) throw new HttpError(404, 'Photo not available', { code: 'PHOTO_NOT_FOUND' });
  return res.photoUri;
}

/* ---------------------------------------------------------- route matrix */

const TRAVEL_MODE = { walk: 'WALK', drive: 'DRIVE', bicycle: 'BICYCLE' };
export const TRAVEL_MODES = Object.keys(TRAVEL_MODE);

const waypoint = ({ lat, lng }) => ({ waypoint: { location: { latLng: { latitude: lat, longitude: lng } } } });

/**
 * One origin → up to 25 destinations in a single Route Matrix call (billed per
 * element, so the caller keeps the list short). Entries Google cannot route come
 * back with null distance rather than being dropped.
 */
export async function distances({ origin, destinations, mode, signal }) {
  const key = `matrix:${mode}:${round(origin.lat, 4)}:${round(origin.lng, 4)}:${destinations
    .map((d) => `${round(d.lat, 4)},${round(d.lng, 4)}`)
    .join('|')}`;

  const elements = await cached(
    key,
    async (innerSignal) => {
      const res = await googleFetch(`${ROUTES_API}/distanceMatrix/v2:computeRouteMatrix`, {
        fieldMask: 'originIndex,destinationIndex,distanceMeters,duration,condition',
        timeoutMs: 8_000,
        signal: innerSignal,
        body: {
          origins: [waypoint(origin)],
          destinations: destinations.map(waypoint),
          travelMode: TRAVEL_MODE[mode],
        },
      });
      return Array.isArray(res) ? res : [];
    },
    { signal }
  );

  const byIndex = new Map(elements.map((e) => [e.destinationIndex ?? 0, e]));
  return destinations.map((d, i) => {
    const e = byIndex.get(i);
    const ok = e && (e.condition === 'ROUTE_EXISTS' || e.condition === undefined) && e.distanceMeters != null;
    return {
      id: d.id,
      distanceMeters: ok ? Math.round(e.distanceMeters) : null,
      durationSeconds: ok ? parseDuration(e.duration) : null,
      straightLineMeters: Math.round(haversineMeters(origin, d)),
    };
  });
}

/* ---------------------------------------------------------- google route */

/**
 * Real-road route for the "go there now" flow. Returned as a GeoJSON LineString —
 * the same geometry shape the OSRM mood routes use, so the map draws both the same
 * way. Not used for Personal/Guided Tour Mode, which stay on OSRM.
 */
export async function computeRoute({ from, to, mode, signal }) {
  const key = `route:${mode}:${round(from.lat, 4)},${round(from.lng, 4)}:${round(to.lat, 4)},${round(to.lng, 4)}`;

  const route = await cached(
    key,
    async (innerSignal) => {
      const res = await googleFetch(`${ROUTES_API}/directions/v2:computeRoutes`, {
        fieldMask: 'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring',
        timeoutMs: 8_000,
        signal: innerSignal,
        body: {
          origin: waypoint(from).waypoint,
          destination: waypoint(to).waypoint,
          travelMode: TRAVEL_MODE[mode],
          polylineEncoding: 'GEO_JSON_LINESTRING',
          // Traffic-aware pricing only applies to driving; walking rejects the field.
          ...(mode === 'drive' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
        },
      });
      return res.routes?.[0] ?? null;
    },
    { signal }
  );

  if (!route?.polyline?.geoJsonLinestring) {
    throw new HttpError(422, `No ${mode} route found between those points`, { code: 'ROUTE_NOT_FOUND' });
  }

  return {
    provider: 'google',
    mode,
    distanceMeters: Math.round(route.distanceMeters ?? 0),
    durationSeconds: parseDuration(route.duration),
    geometry: route.polyline.geoJsonLinestring,
  };
}
