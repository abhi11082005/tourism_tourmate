import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, auth as tokenStore, ApiError } from '../lib/api.js';
import { currentPosition, describePlace, permissionState } from '../lib/geolocate.js';

/*
 * Guest mode is the default state, not an error state. Nothing here blocks
 * rendering: the app boots as a guest, then upgrades to a signed-in session if a
 * stored token still checks out. Login is only forced at the payment boundary
 * (see RequireAuth), which is exactly where the requirements put it.
 *
 * Location capture lives here because it is a property of the session, not of
 * any one screen — but it is deliberately fire-and-forget. A traveller who
 * ignores the browser prompt still lands on their destination page; the manual
 * city box appears afterwards (LocationBanner / dashboard Profile) instead.
 */

const AuthContext = createContext(null);

/** idle → asking → saving → saved | denied | unsupported | failed */
const LOCATION_IDLE = 'idle';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(tokenStore.token ? 'restoring' : 'guest');
  const [locationStatus, setLocationStatus] = useState(LOCATION_IDLE);
  // One capture attempt per session. Without this, every remount of a page that
  // calls captureLocation() re-prompts, which reads as harassment.
  const capturedRef = useRef(false);
  const [token, setToken] = useState(localStorage.getItem('tourmate.token'));

  useEffect(() => {
    if (!tokenStore.token) return;
    const controller = new AbortController();

    api
      .me(controller.signal)
      .then((data) => {
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // Expired or revoked token: fall back to guest rather than a dead end.
        tokenStore.set(null);
        setUser(null);
        setStatus('guest');
      });

    return () => controller.abort();
  }, []);


  
  /** Replace the cached user after a profile, location or preference write. */
  const applyUser = useCallback((next) => {
    if (next) setUser(next);
    return next;
  }, []);

  /**
   * Save an explicit location — the manual fallback, and the "use my location"
   * button in the dashboard.
   * @param {{lat:number,lng:number,source?:string,city?:string,country?:string,setAsHome?:boolean}} payload
   */
const saveLocation = useCallback(
    async (payload) => {
      console.log("👉 9. Backend par location save karne bhej rahe hain payload:", payload);
      setLocationStatus('saving');
      try {
        const { user: next } = await api.setLocation(payload);
        console.log("✅ 10. Backend ne successfully save kar liya! Response:", next);
        setLocationStatus('saved');
        return applyUser(next);
      } catch (err) {
        console.error("❌ 11. Backend API ne save karne se mana kar diya (Error):", err);
        setLocationStatus('failed');
        throw err;
      }
    },
    [applyUser]
  );

  /**
   * Ask the browser, then persist. Resolves to null instead of throwing: the
   * caller is a redirect path, and an unhandled rejection there would be a
   * console error on a perfectly ordinary "no thanks".
   */
const captureLocation = useCallback(
    async ({ force = false } = {}) => {
      console.log("👉 4. AuthContext.captureLocation shuru hua, force:", force);
      if (capturedRef.current && !force) return null;
      capturedRef.current = true;

      if (!force && (await permissionState()) === 'denied') {
        console.log("👉 5. Browser permission pehle se DENIED hai.");
        setLocationStatus('denied');
        return null;
      }

      setLocationStatus('asking');
      try {
        const coords = await currentPosition();
        console.log("👉 6. GPS coordinates mil gaye:", coords);
        
        const place = await describePlace(coords);
        console.log("👉 7. Nominatim se place details mil gayi:", place);
        
        return await saveLocation({ ...coords, ...place, source: 'GPS' });
      } catch (err) {
        console.error("❌ 8. Location capture mein error aa gaya:", err);
        setLocationStatus(
          err.name === 'GeolocationRefused'
            ? err.reason === 'unsupported'
              ? 'unsupported'
              : err.reason === 'denied'
                ? 'denied'
                : 'failed'
            : 'failed'
        );
        return null;
      }
    },
    [saveLocation]
  );

  const finish = useCallback(
    (data) => {
      tokenStore.set(data.token);
      setUser(data.user);
      setStatus('authenticated');
      // Not awaited: the login redirect must not wait on a permission dialog.
      captureLocation().catch(() => {});
      return data.user;
    },
    [captureLocation]
  );

  const login = useCallback(async (credentials) => finish(await api.login(credentials)), [finish]);

  const register = useCallback(async (payload) => finish(await api.register(payload)), [finish]);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setStatus('guest');
    setLocationStatus(LOCATION_IDLE);
    capturedRef.current = false;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isGuest: status !== 'authenticated',
      isAdmin: user?.role === 'ADMIN',
      login,
      register,
      logout,
      applyUser,
      locationStatus,
      captureLocation,
      saveLocation,
      // True once we know the browser will not tell us where they are and they
      // have no saved city either — the cue to offer the manual box.
      needsManualLocation:
        status === 'authenticated' &&
        !user?.home?.city &&
        !user?.lastLocation &&
        ['denied', 'unsupported', 'failed'].includes(locationStatus),
    }),
    [
      user,
      status,
      login,
      register,
      logout,
      applyUser,
      locationStatus,
      captureLocation,
      saveLocation,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { ApiError };
