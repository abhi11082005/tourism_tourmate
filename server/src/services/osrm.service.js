import { env } from '../config/env.js';
import { corridorCandidates } from './attractions.service.js';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';

/*
 * Sensory / mood-based routing.
 *
 * OSRM's HTTP API cannot re-weight edges per request, and rebuilding the graph
 * per mood is far too slow. So mood is expressed as *waypoint choice*: PostGIS
 * scores attractions in the corridor between origin and destination, and the top
 * few become `via` points. A "Scenic" route detours past high-scenic pins; a
 * "Quiet" route prefers low-noise, low-crowd ones; "Fastest" sends no waypoints
 * at all and is a plain OSRM route.
 */

const MOODS = new Set(['scenic', 'quiet', 'fastest', 'food']);

async function osrmFetch(pathname, search, timeoutMs = 4000) {
  const url = `${env.OSRM_BASE_URL}${pathname}?${search}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new HttpError(502, 'Routing service is unavailable', {
        code: 'OSRM_ERROR',
        details: { status: res.status },
      });
    }
    const body = await res.json();
    if (body.code !== 'Ok') {
      throw new HttpError(422, `Could not build a route (${body.code})`, { code: 'OSRM_NO_ROUTE' });
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new HttpError(504, 'Routing timed out — try a shorter route', { code: 'OSRM_TIMEOUT' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const coordPair = ({ lng, lat }) => `${lng.toFixed(6)},${lat.toFixed(6)}`;

/**
 * @param {{from:{lat:number,lng:number}, to:{lat:number,lng:number},
 *          mood?:string, profile?:string}} params
 */
export async function buildMoodRoute({ from, to, mood = 'scenic', profile = env.OSRM_PROFILE }) {
  if (!MOODS.has(mood)) mood = 'scenic';

  const waypoints =
    mood === 'fastest'
      ? []
      : await corridorCandidates({ from, to, mood, limit: mood === 'food' ? 3 : 4 });

  // OSRM keeps the given order with steps=true; PostGIS already sorted by score,
  // so re-sort geographically to avoid a zig-zag polyline.
  const ordered = [...waypoints].sort(
    (a, b) => haversine(from, a) - haversine(from, b)
  );

  const coords = [from, ...ordered.map((w) => ({ lat: w.lat, lng: w.lng })), to]
    .map(coordPair)
    .join(';');

  const search = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    annotations: 'duration,distance',
    continue_straight: 'false',
  }).toString();

  const body = await osrmFetch(`/route/v1/${profile}/${coords}`, search);
  const route = body.routes[0];

  return {
    mood,
    profile,
    distanceMeters: Math.round(route.distance),
    durationSeconds: Math.round(route.duration),
    // GeoJSON LineString — Mapbox GL renders this directly as a layer source.
    geometry: route.geometry,
    waypoints: ordered.map((w) => ({
      id: w.id,
      name: w.name,
      category: w.category,
      lat: w.lat,
      lng: w.lng,
      moodScore: Number(w.mood_score),
      detourMeters: w.detour_m,
      visitMinutes: w.avg_visit_min,
    })),
    steps: route.legs.flatMap((leg) =>
      leg.steps.map((s) => ({
        instruction: s.maneuver?.type,
        modifier: s.maneuver?.modifier,
        name: s.name,
        distanceMeters: Math.round(s.distance),
        durationSeconds: Math.round(s.duration),
      }))
    ),
  };
}

/**
 * Guided Tour Mode: optimal visiting order for a fixed set of stops
 * (OSRM /trip solves the TSP). Falls back to input order if OSRM is down.
 */
export async function optimiseTour({ stops, profile = env.OSRM_PROFILE, roundTrip = true }) {
  if (stops.length < 2) {
    throw new HttpError(400, 'Need at least two stops to plan a tour');
  }
  const coords = stops.map(coordPair).join(';');
  const search = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    roundtrip: String(roundTrip),
    source: 'first',
  }).toString();

  try {
    const body = await osrmFetch(`/trip/v1/${profile}/${coords}`, search, 6000);
    const trip = body.trips[0];
    return {
      distanceMeters: Math.round(trip.distance),
      durationSeconds: Math.round(trip.duration),
      geometry: trip.geometry,
      order: body.waypoints
        .map((w, i) => ({ inputIndex: i, position: w.waypoint_index }))
        .sort((a, b) => a.position - b.position)
        .map((w) => w.inputIndex),
    };
  } catch (err) {
    logger.warn({ err }, 'trip optimisation failed, returning input order');
    throw err;
  }
}

/** Metres between two lat/lng points. Used only for waypoint ordering. */
function haversine(a, b) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
