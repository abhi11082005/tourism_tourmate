import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

/*
 * One place that loads the Google Maps JavaScript API.
 *
 * Nothing here runs at import time except reading two env vars, and the Google
 * script itself is only fetched the first time a map component calls
 * `loadGoogleMaps()`. Every map component is already behind React.lazy, so the tour
 * list, checkout and the rest of the app never download any of it.
 *
 * The browser key (VITE_GOOGLE_MAPS_API_KEY) is public by design — it is visible in
 * the page source of every Google Maps site. What protects it is the restriction
 * you set in Google Cloud: HTTP referrers = your domains, API = Maps JavaScript API
 * only. It is a different key from the server's GOOGLE_MAPS_SERVER_API_KEY.
 */

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');
const KEY = trimmed(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

/**
 * AdvancedMarkerElement requires a Map ID. `DEMO_MAP_ID` works for development and
 * testing; create your own (Vector type) in Cloud Console → Map Management for
 * production, which also lets you style the map and keeps the dark scheme working.
 */
export const MAP_ID = trimmed(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID) || 'DEMO_MAP_ID';

// The shipped example value must read as "not configured".
export const hasMapsKey = Boolean(KEY) && !/^YOUR_/i.test(KEY);

export class MapsUnavailableError extends Error {
  /** @param {'no-key'|'auth'|'load'} reason */
  constructor(reason, message) {
    super(message);
    this.name = 'MapsUnavailableError';
    this.reason = reason;
  }
}

const MESSAGES = {
  'no-key': 'Google Maps is not configured. Set VITE_GOOGLE_MAPS_API_KEY in client/.env.',
  auth: 'Google rejected the Maps key. Check that Maps JavaScript API is enabled and the key allows this site (HTTP referrer restriction).',
  load: 'Could not load Google Maps. Check your connection and try again.',
};

let configured = false;
let authFailed = false;
const authListeners = new Set();

/** Google calls this global when the key is rejected, after the script has loaded. */
function installAuthFailureHook() {
  if (typeof window === 'undefined' || window.gm_authFailure) return;
  window.gm_authFailure = () => {
    authFailed = true;
    authListeners.forEach((fn) => fn(new MapsUnavailableError('auth', MESSAGES.auth)));
  };
}

/** Subscribe to a late key rejection. Returns an unsubscribe function. */
export function onMapsAuthFailure(fn) {
  authListeners.add(fn);
  if (authFailed) fn(new MapsUnavailableError('auth', MESSAGES.auth));
  return () => authListeners.delete(fn);
}

let corePromise = null;

/**
 * Load the libraries every map needs. Repeated calls share one promise, so any
 * number of mounted maps cost one script tag. A failure is not cached: a flaky
 * connection should be retryable on the next mount.
 *
 * @returns {Promise<{ Map: typeof google.maps.Map,
 *                     AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement,
 *                     LatLngBounds: typeof google.maps.LatLngBounds,
 *                     ColorScheme: typeof google.maps.ColorScheme }>}
 */
export function loadGoogleMaps() {
  if (!hasMapsKey) return Promise.reject(new MapsUnavailableError('no-key', MESSAGES['no-key']));
  if (corePromise) return corePromise;

  if (!configured) {
    installAuthFailureHook();
    // `weekly` is the channel Google recommends for new code; it tracks the
    // current stable release. `loading=async` is applied by the loader itself.
    setOptions({ key: KEY, v: 'weekly' });
    configured = true;
  }

  corePromise = Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('core')])
    .then(([maps, marker, core]) => ({
      Map: maps.Map,
      Polyline: maps.Polyline,
      Circle: maps.Circle,
      InfoWindow: maps.InfoWindow,
      AdvancedMarkerElement: marker.AdvancedMarkerElement,
      LatLngBounds: core.LatLngBounds,
      ColorScheme: core.ColorScheme,
    }))
    .catch((err) => {
      corePromise = null;
      throw err instanceof MapsUnavailableError ? err : new MapsUnavailableError('load', MESSAGES.load);
    });

  return corePromise;
}

export const mapsErrorMessage = (err) =>
  err instanceof MapsUnavailableError ? err.message : MESSAGES.load;
