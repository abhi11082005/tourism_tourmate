import { useState } from 'react';
import { Clock, MapPin, Star } from 'lucide-react';
import { CATEGORY_STYLE } from '../../lib/mapMarkers.js';
import { placeImage, ratingLabel, straightLabel, travelLabel } from '../../lib/discovery.js';

/* Small presentational pieces shared by the list card, the map preview and the detail sheet. */

export function SourceBadge({ source }) {
  return source === 'tourmate' ? (
    <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sand-50 dark:bg-sand-300 dark:text-ink-900">
      TourMate pick
    </span>
  ) : (
    <span className="rounded-full border border-sand-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-700 dark:border-ink-600 dark:text-sand-300">
      Google Places
    </span>
  );
}

export function CategoryDot({ place }) {
  const color = (CATEGORY_STYLE[place.kind] ?? CATEGORY_STYLE.attraction).color;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold capitalize">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {place.label}
    </span>
  );
}

export function Rating({ place }) {
  const label = ratingLabel(place);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" title="Google rating">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
      {label}
    </span>
  );
}

/** Only renders when Google actually reported opening hours — unknown shows nothing. */
export function OpenNow({ place }) {
  if (place.openNow == null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${
        place.openNow ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
      }`}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      {place.openNow ? 'Open now' : 'Closed now'}
    </span>
  );
}

/**
 * Two different numbers, labelled as what they are: "450 m away" is a straight line
 * (PostGIS / great-circle); "650 m · 9 min walk" exists only once Google Routes has
 * actually computed it.
 */
export function Distances({ place, travel, mode }) {
  const straight = straightLabel(place);
  const road = travelLabel(travel, mode);
  if (!straight && !road) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      {straight && (
        <span className="muted" title="Straight-line distance">
          {straight}
        </span>
      )}
      {road && (
        <span className="font-semibold text-ink-800 dark:text-sand-50" title="Road distance and time from Google Routes">
          {road}
        </span>
      )}
    </p>
  );
}

const PRICE_WORD = ['Free', '₹', '₹₹', '₹₹₹', '₹₹₹₹'];

/** Only when Google reported a price level. */
export function PriceLevel({ place }) {
  if (place.priceLevel == null) return null;
  return (
    <span className="text-xs font-semibold" title="Price level reported by Google">
      {PRICE_WORD[place.priceLevel]}
    </span>
  );
}

/** Rides: the kind of ride, and an honest note that we have not checked it is running. */
export function RideNote({ place }) {
  if (!place.rideType) return null;
  return (
    <p className="text-xs">
      <span className="font-semibold">{place.rideType}</span>
      <span className="faint"> · Availability, timings and prices not verified — check before you go.</span>
    </p>
  );
}

export function PlaceImage({ place, className = '', width = 480 }) {
  const src = placeImage(place, width);
  const [failed, setFailed] = useState(null);
  const broken = failed === src;
  return src && !broken ? (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`object-cover ${className}`}
      onError={() => setFailed(src)}
    />
  ) : (
    <div className={`grid place-items-center bg-sand-100 text-sand-500 dark:bg-ink-800 ${className}`} aria-hidden>
      <MapPin className="h-6 w-6" />
    </div>
  );
}
