import { Clock, Flag, Route as RouteIcon, Ruler, Sparkles } from 'lucide-react';
import { km, minutes } from '../../lib/format.js';
import Enter from './Enter.jsx';

/*
 * Result of a route request — personal or guided. Reads only what the backend returned:
 * `distanceMeters` / `durationSeconds` (absent on a guide's saved line), `waypoints`
 * (with optional `detourMeters`), `guideName`, and `source`. `source === 'optimised'`
 * is the server telling us there is no curated line and the order was computed.
 */
export default function RouteSummaryCard({ route, destinationName }) {
  if (!route) return null;

  const hasStats = route.distanceMeters != null;
  const optimised = route.source === 'optimised';
  const waypoints = route.waypoints ?? [];

  return (
    <Enter
      as="section"
      aria-label="Route summary"
      aria-live="polite"
      className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/30 dark:bg-emerald-950/30"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
          <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
          Your route is ready
        </p>
        {optimised && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold dark:bg-ink-800">
            <Sparkles className="h-3 w-3 text-glow" aria-hidden />
            Optimised
          </span>
        )}
      </div>

      {destinationName && (
        <p className="mt-2 flex items-center gap-2 text-sm">
          <RouteIcon className="h-4 w-4 shrink-0 text-sand-500" aria-hidden />
          <span className="min-w-0">
            To <span className="font-bold">{destinationName}</span>
          </span>
        </p>
      )}

      {hasStats ? (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white p-3 dark:bg-ink-800">
            <dt className="faint flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
              <Ruler className="h-3.5 w-3.5" aria-hidden />
              Distance
            </dt>
            <dd className="mt-0.5 text-xl font-black tabular-nums">{km(route.distanceMeters)}</dd>
          </div>
          <div className="rounded-xl bg-white p-3 dark:bg-ink-800">
            <dt className="faint flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Estimated time
            </dt>
            <dd className="mt-0.5 text-xl font-black tabular-nums">{minutes(route.durationSeconds)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-sm font-bold">
          <Flag className="h-4 w-4 text-glow" aria-hidden />
          {route.guideName ? `${route.guideName}'s route` : "Your guide's route"}
        </p>
      )}

      {/* A guide's name is also worth showing next to computed stats, when we have both. */}
      {hasStats && route.guideName && (
        <p className="muted mt-2 text-xs">Guide: {route.guideName}</p>
      )}

      {optimised && (
        <p className="muted mt-3 text-xs leading-relaxed">
          No curated line for this departure yet — this is the shortest order through the stops.
        </p>
      )}

      {waypoints.length > 0 && (
        <ol className="mt-4 space-y-0">
          {waypoints.map((w, i) => (
            <li key={w.id ?? `${w.name}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
              {i < waypoints.length - 1 && (
                <span aria-hidden className="absolute bottom-0 left-[11px] top-6 w-px bg-emerald-300/70 dark:bg-emerald-500/30" />
              )}
              <span
                aria-hidden
                className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-800 text-xs font-bold text-sand-50 dark:bg-sand-300 dark:text-ink-900"
              >
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5 text-sm leading-snug">
                {w.name}
                {w.detourMeters ? (
                  <span className="faint block text-xs">+{km(w.detourMeters)} detour</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Enter>
  );
}
