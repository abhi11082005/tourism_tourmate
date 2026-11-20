import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { inr, shortDate } from '../../lib/format.js';

/*
 * Price choices inside the chat: date, seats and the tour's options.
 *
 * Read-only. Every change re-prices through the existing PUBLIC quote endpoint
 * (POST /bookings/quote), the same one the booking panel uses, so the number a
 * traveller sees here is computed by the server and matches the booking rail.
 * Nothing is held or reserved; "Continue" hands off to the tour page.
 *
 * The first quote arrives with the message, so no request is made until the
 * traveller actually changes something.
 */

const MAX_SEATS = 20;

export default function QuoteCard({ block }) {
  const { tourId, slug, options = {}, dates = [] } = block;

  const [seatCount, setSeatCount] = useState(block.seatCount);
  const [slotId, setSlotId] = useState(block.slotId ?? null);
  const [selected, setSelected] = useState({});
  const [quote, setQuote] = useState({ total: block.totalAmount, lines: block.lines });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const touched = useRef(false);

  const chosenDate = dates.find((d) => d.slotId === slotId);
  const seatCap = Math.min(MAX_SEATS, chosenDate?.seatsLeft ?? MAX_SEATS);

  useEffect(() => {
    if (!touched.current) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const selectedOptions = Object.fromEntries(
          Object.entries(selected).filter(([, v]) => v !== false && v !== '')
        );
        const res = await api.quote(
          { tourId, ...(slotId ? { slotId } : {}), seatCount, selectedOptions },
          controller.signal
        );
        setQuote({ total: res.totalAmount, lines: res.breakdown.lines });
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message ?? 'Could not update the price');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tourId, slotId, seatCount, selected]);

  const change = (fn) => {
    touched.current = true;
    fn();
  };

  const pickDate = (d) =>
    change(() => {
      setSlotId(d ? d.slotId : null);
      if (d && seatCount > d.seatsLeft) setSeatCount(Math.max(d.seatsLeft, 1));
    });

  return (
    <section className="card space-y-3 p-3 text-sm" aria-label="Price estimate">
      <div>
        <p className="faint text-xs">Date</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={slotId === null}
            onClick={() => pickDate(null)}
            className={`chip min-h-9 ${slotId === null ? 'bg-ink-800 text-sand-50 dark:bg-sand-300 dark:text-ink-900' : ''}`}
          >
            Any date
          </button>
          {dates.map((d) => {
            const full = d.seatsLeft < 1;
            const active = slotId === d.slotId;
            return (
              <button
                key={d.slotId}
                type="button"
                aria-pressed={active}
                disabled={full}
                onClick={() => pickDate(d)}
                className={`chip min-h-9 disabled:opacity-40 ${
                  active ? 'bg-ink-800 text-sand-50 dark:bg-sand-300 dark:text-ink-900' : ''
                }`}
              >
                {shortDate(d.date)} · {d.seatsLeft} left
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="faint text-xs">Seats</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost !min-h-9 !px-3"
            aria-label="Fewer seats"
            disabled={seatCount <= 1}
            onClick={() => change(() => setSeatCount((n) => Math.max(1, n - 1)))}
          >
            −
          </button>
          <output className="w-6 text-center font-semibold" aria-live="polite">
            {seatCount}
          </output>
          <button
            type="button"
            className="btn-ghost !min-h-9 !px-3"
            aria-label="More seats"
            disabled={seatCount >= seatCap}
            onClick={() => change(() => setSeatCount((n) => Math.min(seatCap, n + 1)))}
          >
            +
          </button>
        </div>
      </div>

      {Object.entries(options).map(([key, spec]) => {
        if (spec.type === 'boolean') {
          return (
            <label key={key} className="flex min-h-9 items-center justify-between gap-3">
              <span>
                {spec.label ?? key}
                {spec.pricePerSeat ? (
                  <span className="faint"> · +{inr(spec.pricePerSeat)} per seat</span>
                ) : null}
              </span>
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={selected[key] === true}
                onChange={(e) => change(() => setSelected((s) => ({ ...s, [key]: e.target.checked })))}
              />
            </label>
          );
        }
        if (spec.type === 'enum') {
          return (
            <label key={key} className="flex items-center justify-between gap-3">
              <span>{spec.label ?? key}</span>
              <select
                className="field !min-h-9 !w-auto"
                value={selected[key] ?? spec.default ?? ''}
                onChange={(e) => change(() => setSelected((s) => ({ ...s, [key]: e.target.value })))}
              >
                {(spec.choices ?? []).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label ?? c.value}
                    {c.pricePerSeat ? ` (+${inr(c.pricePerSeat)} per seat)` : ''}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return null;
      })}

      <ul className="space-y-0.5 border-t border-sand-100 pt-2 dark:border-ink-600">
        {quote.lines.map((l) => (
          <li key={l.key} className="flex justify-between gap-3">
            <span className="muted">{l.label}</span>
            <span>{inr(l.amount)}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3" aria-live="polite" aria-busy={busy}>
        <span className="font-semibold">Total</span>
        <span className={`text-base font-bold ${busy ? 'opacity-50' : ''}`}>{inr(quote.total)}</span>
      </div>

      {error && <p className="notice-error">{error}</p>}

      <Link to={slug ? `/tours/${slug}` : '/explore'} className="btn-primary w-full">
        Continue on the tour page
      </Link>
      <p className="faint text-center text-[11px]">An estimate only. Seats are not held until you book.</p>
    </section>
  );
}
