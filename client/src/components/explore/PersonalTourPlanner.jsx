import { Loader2, LocateFixed, MapPin, Route as RouteIcon, X } from 'lucide-react';
import MoodSelector from './MoodSelector.jsx';
import TransportSelector from './TransportSelector.jsx';
import RouteSummaryCard from './RouteSummaryCard.jsx';
import { categoryColor, categoryLabel, SECTION_LABEL } from './exploreConfig.js';

/*
 * Personal Tour: start → destination → mood → transport → "Create my route".
 * Presentational: every value and handler is Explore's. The button's disabled rule is the
 * page's original one (needs a destination and coordinates, and not already running).
 */

function StartingPoint({ geo }) {
  const locating = geo.state === 'locating';
  const blocked = geo.state === 'denied' || geo.state === 'unsupported';

  return (
    <div>
      <p className={SECTION_LABEL}>Starting from</p>
      <div className="mt-2 flex items-center gap-3 rounded-2xl border border-sand-200 bg-white/70 p-3 dark:border-ink-600 dark:bg-ink-800/50">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
          <LocateFixed className="h-[18px] w-[18px]" aria-hidden />
          {geo.isPrecise && (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-ink-800" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {geo.isPrecise ? 'Your current location' : geo.fallbackLabel}
          </p>
          <p className="faint truncate text-xs">
            {geo.isPrecise ? 'Using your device location' : 'Approximate starting point'}
          </p>
        </div>
        <button
          type="button"
          onClick={geo.request}
          disabled={locating}
          className="btn-ghost min-h-10 shrink-0 px-3 text-xs"
        >
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {locating ? 'Locating…' : geo.isPrecise ? 'Update my location' : 'Use my location'}
        </button>
      </div>
      {blocked && (
        <p className="faint mt-2 text-xs" role="status">
          {geo.state === 'denied'
            ? 'Location access was blocked, so routes start from the point above.'
            : "This browser can't share a location, so routes start from the point above."}
        </p>
      )}
    </div>
  );
}

function Destination({ destination, onClear }) {
  return (
    <div>
      <p className={SECTION_LABEL}>Destination</p>
      {destination ? (
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-ink-800 bg-white p-3 dark:border-sand-300 dark:bg-ink-800">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
            style={{ backgroundColor: categoryColor(destination.category) }}
          >
            <MapPin className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{destination.name}</p>
            {destination.category && <p className="faint text-xs capitalize">{categoryLabel(destination.category)}</p>}
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear destination"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sand-500 transition hover:bg-sand-100 dark:hover:bg-ink-700"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-dashed border-sand-300 p-3 dark:border-ink-500">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sand-100 text-sand-500 dark:bg-ink-800">
            <MapPin className="h-[18px] w-[18px]" />
          </span>
          <p className="muted text-sm">Pick a pin on the map to choose where you are going.</p>
        </div>
      )}
    </div>
  );
}

export default function PersonalTourPlanner({
  geo,
  destination,
  onClearDestination,
  mood,
  onMoodChange,
  profile,
  onProfileChange,
  onBuild,
  building,
  buildError,
  route,
}) {
  const canBuild = Boolean(destination) && Boolean(geo.coords) && !building;

  return (
    <div className="space-y-5">
      <StartingPoint geo={geo} />
      <Destination destination={destination} onClear={onClearDestination} />

      <div>
        <p className={`${SECTION_LABEL} mb-2`}>Set your mood</p>
        <MoodSelector value={mood} onChange={onMoodChange} />
      </div>

      <div>
        <p className={`${SECTION_LABEL} mb-2`}>How are you getting there?</p>
        <TransportSelector value={profile} onChange={onProfileChange} />
      </div>

      <div>
        <button
          type="button"
          className="btn-primary w-full min-h-12 text-base shadow-lg"
          disabled={!canBuild}
          aria-busy={building}
          onClick={onBuild}
        >
          {building ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Plotting your route…
            </>
          ) : (
            <>
              <RouteIcon className="h-4 w-4" aria-hidden />
              Create my route
            </>
          )}
        </button>

        {building && (
          <div className="mt-3" role="status">
            <div className="h-1 overflow-hidden rounded-full bg-sand-100 dark:bg-ink-800">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-glow" />
            </div>
            <p className="faint mt-1.5 text-center text-xs">Finding the best {mood} way there. This takes a moment.</p>
          </div>
        )}
        {!building && !destination && (
          <p className="faint mt-2 text-center text-xs">Choose a destination on the map to continue.</p>
        )}
      </div>

      {buildError && (
        <p className="notice-error" role="alert">
          {buildError.message}
        </p>
      )}

      <RouteSummaryCard route={route} destinationName={destination?.name} />
    </div>
  );
}
