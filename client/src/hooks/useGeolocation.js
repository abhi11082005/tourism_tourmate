import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const JAIPUR = { lat: 26.9124, lng: 75.7873 };

/**
 * Location for "Near Me". Permission is never requested on mount — that prompt
 * on first paint is what makes people leave. The app falls back to a known point
 * and only asks the browser when the user taps "Use my location".
 *
 * The fallback is layered, best first: the fix captured at sign-in, then the home
 * city on the account, then Jaipur. A signed-in traveller therefore gets results
 * near them on first paint without any prompt at all, and only sees Jaipur if we
 * have never learned anything about where they are.
 */
export function useGeolocation({ auto = false } = {}) {
  const { user } = useAuth();
  const [coords, setCoords] = useState(null);
  const [state, setState] = useState('idle'); // idle | locating | granted | denied | unsupported
  const [error, setError] = useState(null);

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

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState('unsupported');
      return;
    }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState('granted');
      },
      (err) => {
        setError(err.message);
        setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'idle');
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 }
    );
  }, []);

  useEffect(() => {
    if (auto) request();
  }, [auto, request]);

  return {
    coords: coords ?? { lat: fallback.lat, lng: fallback.lng },
    // True only for a fix this tab just took. A remembered position is a good
    // guess, not a precise one, so callers still label it as approximate.
    isPrecise: Boolean(coords),
    state,
    error,
    request,
    fallback,
    fallbackLabel: fallback.label,
  };
}
