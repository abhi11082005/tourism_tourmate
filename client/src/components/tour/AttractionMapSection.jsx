import { lazy, Suspense, useRef } from 'react';
import { ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react';
import { useInView } from '../../hooks/useInView.js';

// The map is ~900kB of MapLibre GL. It is imported lazily AND only mounted once this
// section is near the viewport (or the traveller asked for it by picking a stop), so
// the itinerary above the fold never pays for WebGL.
const MapCanvas = lazy(() => import('../MapCanvas.jsx'));

const CATEGORY_LABEL = {
  MUST_VISIT: { label: 'Must visit', color: '#3b5bdb' },
  MUST_EAT: { label: 'Must eat', color: '#e8590c' },
  FAMOUS_RIDE: { label: 'Famous ride', color: '#0ca678' },
};

const categoryText = (category) =>
  CATEGORY_LABEL[category]?.label ?? String(category ?? '').toLowerCase().replace(/_/g, ' ');

function MapSkeleton({ label }) {
  return (
    <div className="grid h-[56vh] min-h-[340px] w-full place-items-center rounded-2xl bg-sand-100 md:h-[560px] dark:bg-ink-800">
      <span className="faint flex flex-col items-center gap-2 text-sm">
        <MapPin className="h-6 w-6 animate-pulse" aria-hidden />
        {label}
      </span>
    </div>
  );
}

function StopDetail({ stop, index, total, days, onPrev, onNext }) {
  return (
    <article
      aria-live="polite"
      className="overflow-hidden rounded-2xl border border-sand-200 bg-white dark:border-ink-600 dark:bg-ink-900 sm:flex"
    >
      {stop.image_url && (
        <img
          src={stop.image_url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-44 w-full object-cover sm:h-auto sm:w-48 sm:shrink-0"
        />
      )}
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="faint flex flex-wrap items-center gap-x-2 text-[11px] font-bold uppercase tracking-[0.14em]">
              <span>
                Stop {index + 1} of {total}
              </span>
              {days?.length > 0 && <span>· Day {days.join(', ')}</span>}
            </p>
            <h3 className="mt-1 text-lg font-black leading-tight tracking-tight">{stop.name}</h3>
          </div>
          {total > 1 && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={onPrev}
                disabled={index === 0}
                aria-label="Previous stop"
                className="grid h-10 w-10 place-items-center rounded-full border border-sand-300 transition hover:bg-sand-100 disabled:opacity-40 dark:border-ink-600 dark:hover:bg-ink-800"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={index === total - 1}
                aria-label="Next stop"
                className="grid h-10 w-10 place-items-center rounded-full border border-sand-300 transition hover:bg-sand-100 disabled:opacity-40 dark:border-ink-600 dark:hover:bg-ink-800"
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {stop.category && (
            <span className="inline-flex items-center gap-1.5 font-semibold capitalize">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CATEGORY_LABEL[stop.category]?.color ?? '#868e96' }}
              />
              {categoryText(stop.category)}
            </span>
          )}
          {stop.avg_visit_min > 0 && (
            <span className="faint inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              About {stop.avg_visit_min} min
            </span>
          )}
        </div>

        {stop.description && (
          <p className="muted mt-3 text-sm leading-relaxed">{stop.description}</p>
        )}
      </div>
    </article>
  );
}

export default function AttractionMapSection({
  attractions,
  stops,
  route,
  initialView,
  selectedStop,
  onSelectStop,
  daysByStop,
  requested,
}) {
  const holderRef = useRef(null);
  const near = useInView(holderRef, { rootMargin: '300px 0px' });
  const shouldLoad = requested || near;

  const selected = selectedStop != null ? stops[selectedStop] : null;
  const present = [...new Set(stops.map((s) => s.category).filter((c) => CATEGORY_LABEL[c]))];

  return (
    <div className="space-y-4">
      <div ref={holderRef}>
        {shouldLoad ? (
          <Suspense fallback={<MapSkeleton label="Loading map…" />}>
            <MapCanvas
              pins={attractions}
              stops={stops}
              route={route}
              initialView={initialView}
              selectedStop={selectedStop}
              onStopSelect={onSelectStop}
              fitToStops
              onPinSelect={(picked) => {
                const i = stops.findIndex((s) => s.id === picked.id);
                if (i >= 0) onSelectStop(i);
              }}
              className="h-[56vh] min-h-[340px] w-full md:h-[560px]"
            />
          </Suspense>
        ) : (
          <MapSkeleton label="The map loads as you scroll here" />
        )}
      </div>

      <div className="faint flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>Numbered stops are joined in visit order.</span>
        {present.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: CATEGORY_LABEL[c].color }}
            />
            {CATEGORY_LABEL[c].label}
          </span>
        ))}
      </div>

      <ol
        aria-label="Stops on the map"
        className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {stops.map((stop, i) => {
          const active = selectedStop === i;
          return (
            <li key={stop.id ?? i} className="shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onSelectStop(i)}
                aria-pressed={active}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-sm transition ${
                  active
                    ? 'border-glow bg-glow/10 font-semibold'
                    : 'border-sand-300 hover:border-glow dark:border-ink-600'
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                    active ? 'bg-glow text-white' : 'bg-ink-800 text-sand-50 dark:bg-sand-300 dark:text-ink-900'
                  }`}
                >
                  {i + 1}
                </span>
                {stop.name}
              </button>
            </li>
          );
        })}
      </ol>

      {selected ? (
        <StopDetail
          stop={selected}
          index={selectedStop}
          total={stops.length}
          days={daysByStop.get(selectedStop)}
          onPrev={() => onSelectStop(Math.max(0, selectedStop - 1))}
          onNext={() => onSelectStop(Math.min(stops.length - 1, selectedStop + 1))}
        />
      ) : (
        <p className="faint text-sm">Tap a numbered marker or stop to see what is there.</p>
      )}
    </div>
  );
}
