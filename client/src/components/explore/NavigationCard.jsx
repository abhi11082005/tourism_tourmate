import { ExternalLink, MapPin, RotateCcw } from 'lucide-react';
import { TRAVEL_MODES, googleDirectionsUrl } from '../../lib/discovery.js';
import { km, minutes } from '../../lib/format.js';

/*
 * "Take me there": a real-road route from Google Routes API, drawn on the map, plus
 * a deep link into Google Maps for actual turn-by-turn. The page itself does not
 * navigate live and does not claim to.
 */
export default function NavigationCard({
  destination,
  origin, // { lat, lng, approximate, label }
  mode,
  onMode,
  route, // the route currently drawn, if it came from Google
  pending,
  error,
  onReset,
  onUseLocation,
}) {
  const url = googleDirectionsUrl({
    // With only an approximate start we leave `origin` out: Google then starts from
    // the device's real position instead of a guess of ours.
    origin: origin.approximate ? null : origin,
    destination,
    mode,
  });

  return (
    <section
      aria-label="Route to destination"
      className="rounded-2xl border border-sand-200 bg-white p-3 shadow-xl dark:border-ink-600 dark:bg-ink-900"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="faint text-[11px] font-bold uppercase tracking-[0.14em]">Route to</p>
          <h3 className="flex items-center gap-1.5 text-sm font-black leading-tight">
            <MapPin className="h-4 w-4 shrink-0 text-glow" aria-hidden />
            <span className="truncate">{destination.name}</span>
          </h3>
        </div>
        <button type="button" className="btn-ghost min-h-9 shrink-0 px-3 text-xs" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset
        </button>
      </div>

      <p className="muted mt-2 text-xs">
        From:{' '}
        <span className="font-semibold">
          {origin.approximate ? `${origin.label} (approximate)` : 'your current location'}
        </span>
        {origin.approximate && (
          <>
            {' · '}
            <button type="button" className="font-semibold underline" onClick={onUseLocation}>
              Use my location
            </button>
          </>
        )}
      </p>

      <div role="group" aria-label="Travel mode" className="mt-2 flex gap-2">
        {TRAVEL_MODES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
            className={`chip min-h-9 flex-1 justify-center ${
              mode === value ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900' : ''
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-10" aria-live="polite">
        {pending ? (
          <p className="faint animate-pulse text-sm">Plotting route…</p>
        ) : error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        ) : route?.provider === 'google' ? (
          <p className="text-base font-black">
            {km(route.distanceMeters)}
            {route.durationSeconds != null && <> · {minutes(route.durationSeconds)}</>}
            <span className="faint ml-2 text-xs font-medium capitalize">by road · {route.mode}</span>
          </p>
        ) : null}
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary mt-2 w-full text-sm"
      >
        <ExternalLink className="h-4 w-4" aria-hidden />
        Navigate with Google Maps
      </a>
    </section>
  );
}
