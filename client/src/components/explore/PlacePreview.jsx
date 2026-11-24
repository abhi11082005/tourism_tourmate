import { Compass, Navigation, X } from 'lucide-react';
import { CategoryDot, Distances, OpenNow, PlaceImage, Rating, SourceBadge } from './PlaceBits.jsx';

/*
 * The card that opens when a marker or list row is selected. A React overlay rather
 * than an InfoWindow, so it follows the app's theme and carries real buttons.
 */
export default function PlacePreview({ place, travel, mode, onClose, onDetails, onDirections, onExploreNearby, className = '' }) {
  return (
    <section
      aria-label={`${place.name}, selected place`}
      className={`overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-xl dark:border-ink-600 dark:bg-ink-900 ${className}`}
    >
      <div className="relative">
        <PlaceImage place={place} width={640} className="h-28 w-full" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-ink-900/70 text-white backdrop-blur hover:bg-ink-900"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-2 p-3">
        <div>
          <h3 className="text-base font-black leading-tight">{place.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <SourceBadge source={place.source} />
            <CategoryDot place={place} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Rating place={place} />
          <OpenNow place={place} />
        </div>
        <Distances place={place} travel={travel} mode={mode} />

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-primary min-h-10 flex-1 px-3 text-xs" onClick={() => onDetails(place)}>
            View details
          </button>
          <button type="button" className="btn-ghost min-h-10 flex-1 px-3 text-xs" onClick={() => onDirections(place)}>
            <Navigation className="h-3.5 w-3.5" aria-hidden />
            Directions
          </button>
        </div>
        <button
          type="button"
          onClick={() => onExploreNearby(place)}
          className="btn-ghost min-h-10 w-full px-3 text-xs"
        >
          <Compass className="h-3.5 w-3.5" aria-hidden />
          Explore around {place.name}
        </button>
      </div>
    </section>
  );
}
