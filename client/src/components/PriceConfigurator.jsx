import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { inr } from '../lib/format.js';

/*
 * Dynamic pricing configurator.
 *
 * The controls are generated from tours.options (JSONB), so an admin adding a new
 * upgrade needs no client change. The displayed total always comes from
 * POST /bookings/quote — the client never does the arithmetic, because the server
 * recomputes it at checkout and a mismatch would be a support ticket.
 */

/** Defaults straight from the catalogue: enums take their `default`, booleans off. */
export function defaultSelection(options = {}) {
  const out = {};
  for (const [key, spec] of Object.entries(options)) {
    if (spec.type === 'enum' && spec.default !== undefined) out[key] = spec.default;
    if (spec.type === 'boolean') out[key] = false;
  }
  return out;
}

export default function PriceConfigurator({
  tour,
  slotId,
  seatCount,
  onSeatCountChange,
  selected,
  onSelectedChange,
  maxSeats = 20,
}) {
  const [debounced, setDebounced] = useState({ seatCount, selected });

  // Every toggle would otherwise fire a quote; 250ms collapses a burst of taps.
  useEffect(() => {
    const id = setTimeout(() => setDebounced({ seatCount, selected }), 250);
    return () => clearTimeout(id);
  }, [seatCount, selected]);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['quote', tour.id, slotId ?? null, debounced.seatCount, debounced.selected],
    queryFn: ({ signal }) =>
      api.quote(
        {
          tourId: tour.id,
          slotId: slotId ?? undefined,
          seatCount: debounced.seatCount,
          selectedOptions: debounced.selected,
        },
        signal
      ),
    // Prices only move when the inputs move, so the cached quote is reusable.
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const entries = useMemo(() => Object.entries(tour.options ?? {}), [tour.options]);
  const set = (key, value) => onSelectedChange({ ...selected, [key]: value });

  return (
    <section className="card p-4" aria-label="Price configurator">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="seatCount" className="text-sm font-semibold">
          Travellers
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost h-11 w-11 px-0 text-lg"
            onClick={() => onSeatCountChange(Math.max(1, seatCount - 1))}
            aria-label="One traveller fewer"
          >
            −
          </button>
          <input
            id="seatCount"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxSeats}
            value={seatCount}
            onChange={(e) =>
              onSeatCountChange(Math.min(maxSeats, Math.max(1, Number(e.target.value) || 1)))
            }
            className="field w-16 text-center"
          />
          <button
            type="button"
            className="btn-ghost h-11 w-11 px-0 text-lg"
            onClick={() => onSeatCountChange(Math.min(maxSeats, seatCount + 1))}
            aria-label="One traveller more"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {entries.map(([key, spec]) => {
          if (spec.type === 'boolean') {
            return (
              <label
                key={key}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3"
              >
                <span className="text-sm">
                  {spec.label ?? key}
                  <span className="ml-2 text-xs text-sand-500">
                    +{inr(spec.pricePerSeat)}/seat
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-ink-800"
                  checked={Boolean(selected[key])}
                  onChange={(e) => set(key, e.target.checked)}
                />
              </label>
            );
          }

          if (spec.type === 'enum') {
            return (
              <fieldset key={key}>
                <legend className="mb-2 text-sm font-medium">{spec.label ?? key}</legend>
                <div className="flex flex-wrap gap-2">
                  {(spec.choices ?? []).map((choice) => {
                    const active = (selected[key] ?? spec.default) === choice.value;
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        onClick={() => set(key, choice.value)}
                        aria-pressed={active}
                        className={`chip min-h-11 ${
                          active ? 'border-ink-800 bg-ink-800 text-sand-50' : 'bg-white'
                        }`}
                      >
                        {choice.label ?? choice.value}
                        {choice.pricePerSeat ? ` · +${inr(choice.pricePerSeat)}` : ' · included'}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          }
          return null;
        })}
      </div>

      <div className="mt-5 border-t border-sand-100 pt-4">
        {isError ? (
          <p className="text-sm text-red-700">{error.message}</p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {(data?.breakdown.lines ?? []).map((line) => (
                <li key={line.key} className="flex justify-between gap-3">
                  <span className="text-ink-700">{line.label}</span>
                  <span className="tabular-nums">{inr(line.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-baseline justify-between border-t border-sand-100 pt-3">
              <span className="text-sm font-semibold">
                Total for {seatCount} {seatCount === 1 ? 'traveller' : 'travellers'}
              </span>
              <span className="text-xl font-bold tabular-nums" aria-live="polite">
                {data ? inr(data.totalAmount) : '—'}
                {isFetching && <span className="ml-2 text-xs font-normal text-sand-500">…</span>}
              </span>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
