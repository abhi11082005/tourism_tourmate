/*
 * Pure geolocation helpers (no browser APIs), so they unit-test under plain Node.
 */

const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;

/** Straight-line metres between two {lat,lng}. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MIN_MOVE_M = 15; // ignore jitter smaller than this
export const MIN_INTERVAL_MS = 4_000; // and updates faster than this
export const MAX_ACCURACY_M = 200; // a fix this coarse is not worth showing as "live"

/**
 * Should a new watchPosition fix replace the last accepted one?
 * Accepts the first fix, then only fixes that are reasonably accurate and either moved
 * meaningfully or got notably more accurate. Throttled so a chatty GPS does not
 * re-render the page several times a second.
 *
 * @param {{lat:number,lng:number,accuracy?:number,at:number}|null} prev
 * @param {{lat:number,lng:number,accuracy?:number,at:number}} next
 */
export function shouldAcceptFix(prev, next) {
  if (!Number.isFinite(next?.lat) || !Number.isFinite(next?.lng)) return false;
  if (!prev) return true;
  if (next.accuracy != null && next.accuracy > MAX_ACCURACY_M && (prev.accuracy ?? Infinity) <= MAX_ACCURACY_M) return false;
  if (next.at - prev.at < MIN_INTERVAL_MS) return false;
  const moved = haversine(prev, next);
  const better = prev.accuracy != null && next.accuracy != null && next.accuracy < prev.accuracy * 0.6;
  return moved >= MIN_MOVE_M || better;
}

export const ROUTE_REFRESH_M = 150;
export const ROUTE_REFRESH_MS = 20_000;

/**
 * Route origin policy: the route is NOT recalculated for every GPS tick. The origin is
 * committed on start, then only after moving more than 150 m and at least 20 s since
 * the last commit (or when no precise origin was committed yet).
 */
export function shouldCommitOrigin(committed, fix) {
  if (!fix) return false;
  if (!committed) return true;
  return haversine(committed, fix) > ROUTE_REFRESH_M && fix.at - committed.at >= ROUTE_REFRESH_MS;
}

/** Human description of GPS quality for the nav card. */
export function accuracyLabel(accuracy) {
  if (accuracy == null) return null;
  if (accuracy <= 20) return `Good (±${Math.round(accuracy)} m)`;
  if (accuracy <= 100) return `Fair (±${Math.round(accuracy)} m)`;
  return `Weak (±${Math.round(accuracy)} m)`;
}
