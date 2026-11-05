import { useId, useState } from 'react';
import { ChevronDown, MapPin } from 'lucide-react';

/*
 * Day-by-day itinerary.
 *
 * md+  : a vertical timeline — numbered day nodes joined by a connector line.
 * mobile: the same list as accordion cards (the rail is hidden).
 *
 * A stop is only interactive when it matches one of the tour's mapped attractions
 * (by name); selecting it highlights that numbered marker on the map. Stops that
 * match nothing stay plain text rather than pretending to be clickable.
 */

export const normalizeName = (name) => String(name ?? '').trim().toLowerCase();

export default function ItineraryTimeline({
  days,
  stopIndexByName,
  selectedStop,
  onSelectStop,
}) {
  const baseId = useId();
  const [open, setOpen] = useState(() => new Set(days.length ? [days[0].day] : []));

  const toggle = (day) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  const allOpen = days.length > 0 && days.every((d) => open.has(d.day));

  if (!days.length) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="faint text-sm">
          {days.length} {days.length === 1 ? 'day' : 'days'} · tap a day to expand
        </p>
        <button
          type="button"
          onClick={() => setOpen(allOpen ? new Set() : new Set(days.map((d) => d.day)))}
          className="min-h-9 rounded-lg px-2 text-sm font-semibold underline underline-offset-4"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <ol className="space-y-3 md:space-y-4">
        {days.map((day, i) => {
          const isOpen = open.has(day.day);
          const panelId = `${baseId}-day-${day.day}`;
          const stops = day.stops ?? [];
          const last = i === days.length - 1;

          return (
            <li key={day.day} className="relative md:pl-14">
              <span
                aria-hidden
                className="absolute left-0 top-3 hidden h-10 w-10 place-items-center rounded-full bg-ink-800 text-sm font-black text-sand-50 shadow-sm md:grid dark:bg-sand-300 dark:text-ink-900"
              >
                {day.day}
              </span>
              {!last && (
                <span
                  aria-hidden
                  className="absolute -bottom-4 left-5 top-[3.25rem] hidden w-px -translate-x-1/2 bg-sand-300 md:block dark:bg-ink-600"
                />
              )}

              <div
                className={`overflow-hidden rounded-2xl border bg-white transition-shadow dark:bg-ink-900 ${
                  isOpen
                    ? 'border-sand-300 shadow-md dark:border-ink-500'
                    : 'border-sand-200 shadow-sm dark:border-ink-600'
                }`}
              >
                <h3>
                  <button
                    type="button"
                    onClick={() => toggle(day.day)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex min-h-16 w-full items-center gap-3 p-4 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="faint block text-[11px] font-bold uppercase tracking-[0.14em]">
                        Day {day.day}
                      </span>
                      <span className="mt-0.5 block font-semibold leading-snug">{day.title}</span>
                    </span>
                    {stops.length > 0 && (
                      <span className="faint hidden shrink-0 text-xs sm:block">
                        {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
                      </span>
                    )}
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-sand-500 transition-transform duration-300 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                      aria-hidden
                    />
                  </button>
                </h3>

                <div
                  id={panelId}
                  aria-hidden={!isOpen}
                  inert={isOpen ? undefined : ''}
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-3 px-4 pb-4">
                      {day.summary && <p className="muted text-sm leading-relaxed">{day.summary}</p>}

                      {stops.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                          {stops.map((stop, s) => {
                            const markerIndex = stopIndexByName.get(normalizeName(stop));
                            const mapped = markerIndex != null;
                            const selected = mapped && selectedStop === markerIndex;

                            if (!mapped) {
                              return (
                                <li
                                  key={`${stop}-${s}`}
                                  className="inline-flex min-h-9 items-center gap-2 rounded-full border border-sand-200 px-3 text-sm dark:border-ink-600"
                                >
                                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sand-400" />
                                  {stop}
                                </li>
                              );
                            }

                            return (
                              <li key={`${stop}-${s}`}>
                                <button
                                  type="button"
                                  onClick={() => onSelectStop(markerIndex)}
                                  aria-pressed={selected}
                                  aria-label={`${stop} — show stop ${markerIndex + 1} on the map`}
                                  className={`inline-flex min-h-9 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-sm transition ${
                                    selected
                                      ? 'border-glow bg-glow/10 font-semibold'
                                      : 'border-sand-300 hover:border-glow dark:border-ink-600'
                                  }`}
                                >
                                  <span
                                    aria-hidden
                                    className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                                      selected
                                        ? 'bg-glow text-white'
                                        : 'bg-ink-800 text-sand-50 dark:bg-sand-300 dark:text-ink-900'
                                    }`}
                                  >
                                    {markerIndex + 1}
                                  </span>
                                  {stop}
                                  <MapPin className="h-3.5 w-3.5 text-sand-500" aria-hidden />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
