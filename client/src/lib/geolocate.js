/*
 * Promise wrapper around the browser Geolocation API.
 *
 * Two things the raw API gets wrong for our purposes:
 *   * its callback style does not compose with async/await, and
 *   * `timeout` only bounds the *fix*, not the permission prompt — a user who
 *     leaves the dialog open leaves the promise pending forever.
 * So the rejection reason is normalised to something the UI can branch on, and
 * the whole thing is wrapped in its own deadline.
 */

/** @typedef {'denied'|'unavailable'|'timeout'|'unsupported'} GeoFailure */

// Inside AuthContext.jsx or geolocate.js
function captureLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('unsupported'));
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (error) => {
        reject(error);
      },
      { timeout: 10000 } // Don't let it hang forever!
    );
  });
}

export class GeolocationRefused extends Error {
  /** @param {GeoFailure} reason */
  constructor(reason, message) {
    super(message);
    this.name = 'GeolocationRefused';
    this.reason = reason;
  }
}

const MESSAGES = {
  denied: 'Location permission was declined',
  unavailable: 'Your device could not get a location fix',
  timeout: 'Getting your location took too long',
  unsupported: 'This browser does not support location',
};

/**
 * @param {{ timeout?: number, highAccuracy?: boolean }} [opts]
 * @returns {Promise<{ lat: number, lng: number, accuracy: number }>}
 */
export function currentPosition({ timeout = 8_000, highAccuracy = false } = {}) {
  if (!('geolocation' in navigator)) {
    return Promise.reject(new GeolocationRefused('unsupported', MESSAGES.unsupported));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => (arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    const fail = done(reject);
    const ok = done(resolve);

    // Covers the "prompt left open" case the platform timeout does not.
    const deadline = setTimeout(
      () => fail(new GeolocationRefused('timeout', MESSAGES.timeout)),
      timeout + 2_000
    );

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(deadline);
        ok({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        clearTimeout(deadline);
        const reason =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        fail(new GeolocationRefused(reason, MESSAGES[reason]));
      },
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 300_000 }
    );
  });
}

/**
 * Has the user already granted location, so we can skip the "may we ask?" step?
 * The Permissions API is not everywhere (Safari lacks it), so an unknown answer
 * is reported as 'prompt' rather than assumed either way.
 *
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function permissionState() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state ?? 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * Forward geocoding for the manual fallback: a typed place name becomes the
 * coordinates the server needs (it stores a PostGIS point, not a string).
 *
 * Same free Nominatim endpoint, and the same reasoning about keys and rate — one
 * call per submitted form. Returns null when nothing matches, which the caller
 * shows as "we could not find that place" rather than an error.
 *
 * @param {string} place
 * @returns {Promise<{lat:number,lng:number,city:string,country?:string}|null>}
 */
export async function geocodePlace(place, signal) {
  const q = place.trim();
  if (q.length < 2) return null;

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
  }).toString();

  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Place lookup is unavailable right now');

  const [hit] = (await res.json()) ?? [];
  if (!hit) return null;

  const a = hit.address ?? {};
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    city: a.city ?? a.town ?? a.village ?? a.state_district ?? q,
    country: a.country ?? undefined,
  };
}

/**
 * Turns a fix into a human-readable place, used only to label it with a city.
 *
 * OpenStreetMap's Nominatim needs no key; its usage policy asks for a low rate,
 * which one call per login comfortably satisfies. A failure here is not an error
 * worth surfacing — the coordinates are the useful part.
 */
export async function describePlace({ lat, lng }, signal) {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: '10',
    }).toString();

    const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
    if (!res.ok) return {};
    const a = (await res.json())?.address ?? {};
    return {
      city: a.city ?? a.town ?? a.village ?? a.state_district ?? a.state ?? undefined,
      country: a.country ?? undefined,
    };
  } catch {
    return {};
  }
}
