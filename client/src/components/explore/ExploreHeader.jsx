import { MapPin } from 'lucide-react';

/*
 * Panel masthead: brand mark, headline and subtitle. There is no search field on
 * purpose — the API exposes pins by map bounds only, with no text search endpoint, and
 * a search box that cannot search would be decoration.
 */
export default function ExploreHeader({ placesLabel }) {
  return (
    <header>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-black tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-800 text-sand-50 dark:bg-sand-300 dark:text-ink-900">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span>
            Tour<span className="text-glow">Mate</span>
          </span>
        </p>
        {placesLabel && (
          <p className="faint flex items-center gap-1.5 text-xs font-semibold" aria-live="polite">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {placesLabel}
          </p>
        )}
      </div>

      <h1 className="mt-4 text-[1.75rem] font-black leading-[1.05] tracking-tight">
        Explore beyond
        <br />
        <span className="text-glow">the ordinary.</span>
      </h1>
      <p className="muted mt-2 text-sm leading-relaxed">
        Every turn has a story. Tap a pin, pick your pace, and find the one that feels like yours.
      </p>
    </header>
  );
}
