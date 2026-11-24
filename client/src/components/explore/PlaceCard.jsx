import { memo } from 'react';
import { Navigation } from 'lucide-react';
import { CategoryDot, Distances, OpenNow, PlaceImage, Rating, SourceBadge } from './PlaceBits.jsx';

/*
 * One discovery result. The main area is a single button (select + show on the map);
 * Details and Directions are separate buttons rather than nested inside it.
 */
function PlaceCard({ place, travel, mode, selected, onSelect, onDetails, onDirections }) {
  return (
    <li
      className={`overflow-hidden rounded-2xl border transition ${
        selected
          ? 'border-glow bg-glow/5 shadow-md'
          : 'border-sand-200 bg-white hover:border-sand-300 dark:border-ink-600 dark:bg-ink-900 dark:hover:border-ink-500'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(place)}
        aria-pressed={selected}
        className="flex w-full gap-3 p-2.5 text-left"
      >
        <PlaceImage place={place} width={200} className="h-[76px] w-[76px] shrink-0 rounded-xl" />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-start justify-between gap-2">
            <span className="block truncate text-sm font-bold leading-tight">{place.name}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SourceBadge source={place.source} />
            <CategoryDot place={place} />
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <Rating place={place} />
            <OpenNow place={place} />
          </span>
          {place.address && <span className="faint block truncate text-xs">{place.address}</span>}
          <Distances place={place} travel={travel} mode={mode} />
        </span>
      </button>

      <div className="flex gap-2 border-t border-sand-100 px-2.5 py-2 dark:border-ink-700">
        <button type="button" className="btn-ghost min-h-9 flex-1 px-3 text-xs" onClick={() => onDetails(place)}>
          View details
        </button>
        <button type="button" className="btn-primary min-h-9 flex-1 px-3 text-xs" onClick={() => onDirections(place)}>
          <Navigation className="h-3.5 w-3.5" aria-hidden />
          Directions
        </button>
      </div>
    </li>
  );
}

export default memo(PlaceCard);

export function PlaceCardSkeleton() {
  return (
    <li className="flex animate-pulse gap-3 rounded-2xl border border-sand-100 p-2.5 dark:border-ink-700" aria-hidden>
      <div className="h-[76px] w-[76px] rounded-xl bg-sand-100 dark:bg-ink-800" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-3.5 w-2/3 rounded bg-sand-100 dark:bg-ink-800" />
        <div className="h-3 w-1/2 rounded bg-sand-100 dark:bg-ink-800" />
        <div className="h-3 w-3/4 rounded bg-sand-100 dark:bg-ink-800" />
      </div>
    </li>
  );
}
