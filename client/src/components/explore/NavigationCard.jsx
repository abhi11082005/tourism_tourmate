import { ExternalLink, MapPin, Navigation, RotateCcw, Radio } from 'lucide-react';
import { TRAVEL_MODES, googleDirectionsUrl } from '../../lib/discovery.js';
import { accuracyLabel } from '../../lib/geo.js';
import { km, minutes } from '../../lib/format.js';

/*
 * "Take me there": a real-road route from Google Routes API drawn on the map, and a
 * prominent deep link into Google Maps for actual turn-by-turn. The page itself does
 * not navigate and does not claim to. With only an approximate start the deep link
 * omits `origin`, so Google starts from the device's real position instead of a guess.
 */

const friendlyError = (error, mode) => {
  if (!error) return null;
  if (error.code === 'ROUTE_NOT_FOUND') {
    return mode === 'bicycle'
      ? 'Google has no cycling route here. Try Walk or Drive, or open Google Maps.'
      : `No ${mode === 'drive' ? 'driving' : 'walking'} route found. Try another mode.`;
  }
  if (error.code === 'GOOGLE_NOT_CONFIGURED') return 'Routing isn’t configured on this server.';
  return error.message ?? 'Couldn’t plot the route.';
};

export default function NavigationCard({
  destination,
  origin, // { lat, lng, approximate, label, accuracy }
  mode,
  onMode,
  route,
  pending,
  error, // { code, message } | null
  onReset,
  onUseLocation,
  tracking,
  onToggleTracking,
  locating,
  denied,
}) {
  const url = googleDirectionsUrl({ origin: origin.approximate ? null : origin, destination, mode });
  const acc = accuracyLabel(origin.accuracy);
  const status = denied
    ? 'Location blocked — enable it in your browser settings'
    : locating
      ? 'Finding your location…'
      : origin.approximate
        ? `Using ${origin.label} (approximate)`
        : tracking
          ? 'Live location on'
          : 'Using your current location';

  return (
    <section aria-label="Route to destination" className="rounded-2xl border border-sand-200 bg-white p-3 shadow-xl dark:border-ink-600 dark:bg-ink-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="faint text-[11px] font-bold uppercase tracking-[0.14em]">Route to</p>
          <h3 className="flex items-start gap-1.5 text-sm font-black leading-tight">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-glow" aria-hidden />
            <span className="break-words">{destination.name}</span>
          </h3>
        </div>
        <button type="button" className="btn-ghost min-h-9 shrink-0 px-3 text-xs" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset
        </button>
      </div>

      <div className="mt-2 rounded-xl bg-sand-50 px-3 py-2 text-xs dark:bg-ink-800">
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">{status}</span>
          {acc && !origin.approximate && <span className="faint">GPS {acc}</span>}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3">
          {origin.approximate && !denied && (
            <button type="button" className="font-semibold underline" onClick={onUseLocation}>
              Use my location
            </button>
          )}
          {!origin.approximate && (
            <button type="button" aria-pressed={tracking} className="inline-flex items-center gap-1 font-semibold underline" onClick={onToggleTracking}>
              <Radio className="h-3 w-3" aria-hidden />
              {tracking ? 'Stop live location' : 'Follow my location'}
            </button>
          )}
        </div>
        {tracking && <p className="faint mt-1 text-[11px]">Updates only while this page is open and visible.</p>}
      </div>

      <div role="group" aria-label="Travel mode" className="mt-2 flex gap-2">
        {TRAVEL_MODES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
            className={`chip min-h-9 flex-1 justify-center ${mode === value ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-10" aria-live="polite">
        {pending ? (
          <p className="faint animate-pulse text-sm">Plotting route…</p>
        ) : error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{friendlyError(error, mode)}</p>
        ) : route?.provider === 'google' ? (
          <p className="text-base font-black">
            {km(route.distanceMeters)}
            {route.durationSeconds != null && <> · {minutes(route.durationSeconds)}</>}
            <span className="faint ml-2 text-xs font-medium">by road · {TRAVEL_MODES.find(([v]) => v === route.mode)?.[1] ?? route.mode}</span>
          </p>
        ) : null}
      </div>

      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary mt-2 min-h-12 w-full text-base font-black">
        <Navigation className="h-5 w-5" aria-hidden />
        Start navigation
        <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </a>
      <p className="faint mt-1 text-center text-[10px]">Opens Google Maps for turn-by-turn directions.</p>
    </section>
  );
}
