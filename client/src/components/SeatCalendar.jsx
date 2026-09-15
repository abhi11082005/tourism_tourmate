import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { inr, shortDate, toIsoDate } from '../lib/format.js';

/*
 * Real-time seat calendar.
 *
 * Availability is the only number on the page that must never be stale, so this
 * query is `staleTime: 0` and refetches on an interval and on window focus. The
 * API sends `cache-control: no-store` for the same reason.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function monthBounds(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { from: toIsoDate(first), to: toIsoDate(last), first, last };
}

function seatTone(slot) {
  if (!slot || !slot.isOpen) return 'bg-sand-100 text-sand-500 cursor-not-allowed';
  if (slot.availableSeats === 0) return 'bg-sand-100 text-sand-500 line-through cursor-not-allowed';
  if (slot.availableSeats <= 3) return 'bg-orange-50 text-orange-700 ring-1 ring-orange-300';
  return 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200';
}

export default function SeatCalendar({ tourId, value, onSelect, seatCount = 1 }) {
  const [cursor, setCursor] = useState(() => new Date());
  const { from, to, first, last } = useMemo(() => monthBounds(cursor), [cursor]);

  const { data, isPending, isError, error, isFetching } = useQuery({
    queryKey: ['calendar', tourId, from, to],
    queryFn: ({ signal }) => api.calendar(tourId, { from, to }, signal),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const byDate = useMemo(() => {
    const map = new Map();
    for (const slot of data?.dates ?? []) map.set(slot.date, slot);
    return map;
  }, [data]);

  // Leading blanks so the 1st lands under the right weekday.
  const cells = useMemo(() => {
    const out = Array.from({ length: first.getDay() }, () => null);
    for (let d = 1; d <= last.getDate(); d += 1) {
      out.push(toIsoDate(new Date(cursor.getFullYear(), cursor.getMonth(), d)));
    }
    return out;
  }, [cursor, first, last]);

  const today = toIsoDate(new Date());
  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <section className="card p-4" aria-label="Departure calendar">
      <header className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="btn-ghost px-3"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold" aria-live="polite">
          {monthLabel}
          {isFetching && <span className="ml-2 text-xs font-normal text-sand-500">updating…</span>}
        </h3>
        <button
          type="button"
          className="btn-ghost px-3"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </header>

      {isError && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error.message}. Seat counts could not be loaded.
        </p>
      )}

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-sand-500">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`}>{d}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <span key={`blank-${i}`} />;
          const slot = byDate.get(iso);
          const past = iso < today;
          const bookable =
            slot && slot.isOpen && !past && slot.availableSeats >= seatCount;
          const isSelected = value?.slotId === slot?.slotId && Boolean(slot);

          return (
            <button
              key={iso}
              type="button"
              disabled={!bookable}
              onClick={() => onSelect(slot)}
              aria-pressed={isSelected}
              aria-label={
                slot
                  ? `${shortDate(iso)} — ${slot.availableSeats} of ${slot.totalSeats} seats free`
                  : `${shortDate(iso)} — no departure`
              }
              className={[
                'min-h-14 rounded-xl p-1 text-xs transition',
                past || !slot ? 'bg-sand-50 text-sand-300 cursor-not-allowed' : seatTone(slot),
                isSelected ? 'ring-2 ring-ink-800 ring-offset-1' : '',
              ].join(' ')}
            >
              <span className="block font-semibold">{Number(iso.slice(-2))}</span>
              {slot && !past && (
                <span className="block text-[10px] leading-tight">
                  {slot.availableSeats === 0 ? 'full' : `${slot.availableSeats} left`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isPending && <p className="mt-3 text-xs text-sand-500">Loading seat counts…</p>}

      {value?.slotId && (
        <footer className="mt-3 rounded-xl bg-sand-50 p-3 text-xs">
          <p className="font-semibold">{shortDate(value.date)} selected</p>
          <p className="text-ink-700">
            {value.availableSeats} of {value.totalSeats} seats free
            {value.heldSeats > 0 && ` · ${value.heldSeats} being checked out right now`}
            {Number(value.priceModifier) !== 0 && ` · ${inr(value.priceModifier)}/seat date surcharge`}
            {value.hasGuide && ' · guide assigned'}
          </p>
        </footer>
      )}
    </section>
  );
}
