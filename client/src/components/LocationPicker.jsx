import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { geocodePlace } from '../lib/geolocate.js';

/*
 * The manual half of the location flow, and the retry for the automatic half.
 *
 * Shared by the post-login banner and the dashboard Profile card so there is one
 * implementation of "how do I tell Tour Mate where I am" — two would drift, and
 * one of them would forget the aria-live region.
 *
 * A typed place is geocoded to coordinates before saving because the server
 * stores a PostGIS point; a bare city string would be useless for "near me".
 */
export default function LocationPicker({ compact = false, onDone }) {
  const { user, locationStatus, captureLocation, saveLocation } = useAuth();
  const [place, setPlace] = useState(user?.home?.city ?? '');
  const [busy, setBusy] = useState(null); // 'auto' | 'manual' | null
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

const useBrowser = async () => {
    console.log("👉 1. 'Use my location' button clicked!"); // Check 1
    setError(null);
    setMessage(null);
    setBusy('auto');
    
    const next = await captureLocation({ force: true });
    console.log("👉 2. captureLocation ka final result:", next); // Check 2
    
    setBusy(null);
    if (next) {
      setMessage('Saved — suggestions are now based on where you are.');
      onDone?.(next);
    } else {
      console.log("👉 3. Location capture null return kiya, status:", locationStatus); // Check 3
      setError(
        locationStatus === 'unsupported'
          ? 'This browser cannot share a location. Type your city instead.'
          : 'We could not get a location from your browser. Type your city instead.'
      );
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy('manual');
    try {
      const hit = await geocodePlace(place);
      if (!hit) {
        setError('We could not find that place. Try a nearby city.');
        return;
      }
      const next = await saveLocation({ ...hit, source: 'MANUAL', setAsHome: true });
      setMessage(`Home set to ${hit.city}${hit.country ? `, ${hit.country}` : ''}.`);
      onDone?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={compact ? 'flex flex-wrap items-end gap-2' : 'space-y-3'}>
        <form onSubmit={submit} className="flex flex-1 flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-sm">
            <span className={compact ? 'sr-only' : 'block pb-1'}>Your city</span>
            <input
              className="field"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="Jaipur, India"
              autoComplete="address-level2"
              disabled={busy !== null}
            />
          </label>
          <button className="btn-primary" disabled={busy !== null || place.trim().length < 2}>
            {busy === 'manual' ? 'Saving…' : 'Save city'}
          </button>
        </form>

        <button type="button" className="btn-ghost" onClick={useBrowser} disabled={busy !== null}>
          {busy === 'auto' ? 'Locating…' : 'Use my location'}
        </button>
      </div>

      {/* One live region for both outcomes: a screen reader hears the result of
          a button press it cannot otherwise observe. */}
      <p aria-live="polite" className="text-xs">
        {error && <span className="text-red-700 dark:text-red-300">{error}</span>}
        {!error && message && <span className="text-emerald-700 dark:text-emerald-300">{message}</span>}
      </p>
    </div>
  );
}
