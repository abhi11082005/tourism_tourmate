import { useState } from 'react';
import { Check, MapPin, Navigation, X } from 'lucide-react';
import { categoryColor, categoryLabel, formatStraightKm } from './exploreConfig.js';

/*
 * The destination the traveller picked on the map. Everything shown is the pin's own
 * data (name, category, image) plus a straight-line distance computed from real
 * coordinates. No description, rating or price is shown, because pins carry none.
 *
 *  variant="panel"   : photo card for the desktop side panel.
 *  variant="compact" : one-row preview for the mobile sheet.
 */

function Thumb({ src, category, className }) {
  const [failed, setFailed] = useState(false);
  const usable = src && src !== 'null' && !failed;

  if (usable) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`grid place-items-center text-white ${className}`}
      style={{
        background: `linear-gradient(135deg, ${categoryColor(category)}, #1d2135)`,
      }}
    >
      <MapPin className="h-1/3 w-1/3 opacity-80" />
    </span>
  );
}

function CategoryChip({ category }) {
  if (!category) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold capitalize">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: categoryColor(category) }} />
      {categoryLabel(category)}
    </span>
  );
}

export default function SelectedAttractionCard({
  attraction,
  straightKm,
  startLabel,
  onClear,
  onPlan,
  variant = 'panel',
}) {
  if (!attraction) return null;

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-sand-200 bg-white p-2 pr-1 dark:border-ink-600 dark:bg-ink-800">
        <Thumb src={attraction.imageUrl} category={attraction.category} className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="faint text-[10px] font-bold uppercase tracking-[0.14em]">Destination</p>
          <p className="truncate text-sm font-bold leading-tight">{attraction.name}</p>
          <CategoryChip category={attraction.category} />
        </div>
        {onPlan && (
          <button type="button" onClick={onPlan} className="btn-primary min-h-10 shrink-0 px-3 text-xs">
            Plan route
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear destination"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sand-500 hover:bg-sand-100 dark:hover:bg-ink-700"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-[0_18px_50px_-18px_rgba(18,20,31,0.4)] backdrop-blur-xl dark:border-ink-600/70 dark:bg-ink-900/90">
      <div className="relative">
        <Thumb src={attraction.imageUrl} category={attraction.category} className="aspect-[16/10] w-full" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-ink-900/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
          <Check className="h-3 w-3 text-glow" strokeWidth={3} aria-hidden />
          Destination selected
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear destination"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-ink-800 shadow transition hover:bg-white dark:bg-ink-900/90 dark:text-sand-50"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <CategoryChip category={attraction.category} />
          <h2 className="mt-1 text-xl font-black leading-tight tracking-tight">{attraction.name}</h2>
        </div>

        {straightKm != null && (
          <p className="muted flex items-center gap-2 text-sm">
            <Navigation className="h-4 w-4 shrink-0 text-sand-500" aria-hidden />
            {straightKm < 0.05 ? (
              <span>Right at your starting point</span>
            ) : (
              <span>
                <span className="font-semibold tabular-nums">{formatStraightKm(straightKm)}</span> away in a straight
                line{startLabel ? ` from ${startLabel}` : ''}
              </span>
            )}
          </p>
        )}

        {onPlan && (
          <button type="button" onClick={onPlan} className="btn-primary w-full">
            Plan a route here
          </button>
        )}
      </div>
    </article>
  );
}
