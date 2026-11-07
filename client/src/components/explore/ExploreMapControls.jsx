import { Eraser, Loader2, LocateFixed } from 'lucide-react';
import { GLASS_PILL } from './exploreConfig.js';

/*
 * Floating controls that sit directly under MapLibre's own zoom buttons (top-right), so
 * zoom + locate read as one column. MapCanvas already provides zoom; this adds only what
 * Explore itself owns: re-centring on the traveller and clearing the drawn route.
 */
const btn = `grid h-11 w-11 place-items-center rounded-full text-ink-800 transition hover:bg-white active:scale-95 dark:text-sand-50 dark:hover:bg-ink-800 ${GLASS_PILL}`;

export default function ExploreMapControls({ geo, hasRoute, onClearRoute }) {
  const locating = geo.state === 'locating';

  return (
    <div className="absolute right-[3px] top-[5.25rem] z-10 flex flex-col gap-2">
      <button
        type="button"
        onClick={geo.request}
        disabled={locating}
        aria-label={geo.isPrecise ? 'Update my location' : 'Use my location'}
        title={geo.isPrecise ? 'Update my location' : 'Use my location'}
        className={`${btn} ${geo.isPrecise ? 'text-sky-600 dark:text-sky-300' : ''}`}
      >
        {locating ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <LocateFixed className="h-5 w-5" aria-hidden />
        )}
      </button>

      {hasRoute && (
        <button type="button" onClick={onClearRoute} aria-label="Clear route" title="Clear route" className={btn}>
          <Eraser className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}
