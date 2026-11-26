import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { currentPosition, GeolocationRefused } from '../lib/geolocate.js';
import { shouldAcceptFix } from '../lib/geo.js';

const JAIPUR = { lat: 26.9124, lng: 75.7873 };

// A fix with worse accuracy than this is still used, but labelled as rough.
export const ROUGH_FIX_METERS = 1_000;

/**
 * Location for "Near Me" and Explore. Permission is never requested on mount — that
 * prompt on first paint is what makes people leave. The app falls back to a known
 * point and only asks the browser when the user taps "Use my location".
 *
 * The fallback is layered, best first: the fix captured at sign-in, then the home
 * city on the account, then Jaipur. A signed-in traveller therefore gets results
 * near them on first paint without any prompt at all, and only sees Jaipur if we
 * have never learned anything about where they are.
 *
 * Two kinds of position, never mixed up:
 *   - `precise`  : a fix this tab just took. null until the user grants one.
 *   - `coords`   : precise when we have it, else the fallback. Kept for existing
 *                  callers (Home's Near Me) that always need *some* point.
 * Anything that presents a position as "you are here" must use `precise`/`isPrecise`.
 * The fix lives in component state only: nothing here writes it to storage or to
 * the server.
 *
 * `state`: idle | locating | granted | denied | unsupported | timeout | unavailable
 * `permission`: what the browser says before we ask — granted | denied | prompt.
 */
export function useGeolocation({ auto = false } = {}) {
  const { user } = useAuth();
  const [precise, setPrecise] = useState(null); // { lat, lng, accuracy, at }
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const [permission, setPermission] = useState('prompt');
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reading the permission state does not prompt; it lets the UI say "blocked" up front.
  useEffect(() => {
    let status;
    let cancelled = false;
    const onChange = () => !cancelled && setPermission(status.state);
    (async () => {
      try {
        status = await navigator.permissions?.query({ name: 'geolocation' });
        if (cancelled || !status) return;
        setPermission(status.state);
        status.addEventListener?.('change', onChange);
      } catch {
        /* Safari: no Permissions API for geolocation — stay at 'prompt' */
      }
    })();
    return () => {
      cancelled = true;
      status?.removeEventListener?.('change', onChange);
    };
  }, []);

  const fallback = useMemo(() => {
    const last = user?.lastLocation;
    if (last?.lat != null && last?.lng != null) {
      return { lat: last.lat, lng: last.lng, label: 'your last known position' };
    }
    const home = user?.home;
    if (home?.lat != null && home?.lng != null) {
      return { lat: home.lat, lng: home.lng, label: home.city ?? 'your home city' };
    }
    return { ...JAIPUR, label: 'Jaipur' };
  }, [user?.lastLocation, user?.home]);

  /**
   * Ask the browser for a fix. Call it from a click handler only. Safe to call again
   * (with `{ fresh: true }`) to refresh. Resolves to the fix, or null on failure (the reason is in `state`).
   */
  const request = useCallback(async ({ highAccuracy = false, fresh = false } = {}) => {
    if (inFlight.current) return null;
    if (!('geolocation' in navigator)) {
      setState('unsupported');
      return null;
    }
    inFlight.current = true;
    setState('locating');
    setError(null);
    try {
      const fix = await currentPosition({
        timeout: highAccuracy ? 15_000 : 10_000,
        highAccuracy,
        // A manual refresh must not be answered from the browser's 5-minute cache.
        maximumAge: fresh ? 0 : 60_000,
      });
      if (!mounted.current) return null;
      const next = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null, at: Date.now() };
      setPrecise(next);
      setState('granted');
      setPermission('granted');
      return next;
    } catch (err) {
      if (!mounted.current) return null;
      const reason = err instanceof GeolocationRefused ? err.reason : 'unavailable';
      setError(err.message);
      setState(reason);
      if (reason === 'denied') setPermission('denied');
      return null;
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (auto) request();
  }, [auto, request]);

  /** Forget the fix (e.g. "stop using my location"). */
  const clear = useCallback(() => {
    setPrecise(null);
    setState('idle');
    setError(null);
  }, []);

  /*
   * Optional live mode. Only starts from an explicit tap, only while the page is
   * visible (paused when the tab is hidden, resumed when it returns — no background
   * tracking), and fixes are throttled by shouldAcceptFix so a chatty GPS does not
   * re-render the page. Always cleaned up on unmount.
   */
  const [tracking, setTracking] = useState(false);
  const watchId = useRef(null);
  const lastAccepted = useRef(null);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

  const startWatch = useCallback(() => {
    if (watchId.current != null || !('geolocation' in navigator)) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!mounted.current) return;
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null, at: Date.now() };
        if (!shouldAcceptFix(lastAccepted.current, next)) return;
        lastAccepted.current = next;
        setPrecise(next);
        setState('granted');
      },
      (err) => {
        if (!mounted.current) return;
        if (err.code === err.PERMISSION_DENIED) {
          stopWatch();
          setTracking(false);
          setPermission('denied');
          setState('denied');
          setError('Location permission was declined');
        }
        // timeouts / unavailable: keep the last fix and keep watching
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );
  }, [stopWatch]);

  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState('unsupported');
      return;
    }
    lastAccepted.current = precise;
    setTracking(true);
  }, [precise]);

  const stopTracking = useCallback(() => {
    setTracking(false);
    stopWatch();
  }, [stopWatch]);

  useEffect(() => {
    if (!tracking) return undefined;
    const onVisibility = () => (document.hidden ? stopWatch() : startWatch());
    if (!document.hidden) startWatch();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopWatch();
    };
  }, [tracking, startWatch, stopWatch]);

  const accuracy = precise?.accuracy ?? null;

  return {
    coords: precise ? { lat: precise.lat, lng: precise.lng } : { lat: fallback.lat, lng: fallback.lng },
    // True only for a fix this tab just took. A remembered position is a good
    // guess, not a precise one, so callers still label it as approximate.
    isPrecise: Boolean(precise),
    precise,
    accuracy,
    isRough: accuracy != null && accuracy > ROUGH_FIX_METERS,
    state,
    permission,
    error,
    request,
    tracking,
    startTracking,
    stopTracking,
    refresh: request,
    clear,
    fallback,
    fallbackLabel: fallback.label,
  };
}
