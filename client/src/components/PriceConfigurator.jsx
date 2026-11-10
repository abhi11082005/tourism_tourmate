import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, LoaderCircle, Minus, Plus, RefreshCw, Sparkles, TriangleAlert, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr } from '../lib/format.js';

/*
 * Dynamic pricing configurator.
 *
 * The controls are generated from tours.options (JSONB), so an admin adding a new
 * upgrade needs no client change. The displayed total always comes from
 * POST /bookings/quote — the client never prices an option, because the server
 * recomputes it at checkout and a mismatch would be a support ticket.
 *
 * What the quote does NOT contain is the campaign and the coupon: startCheckout
 * applies them afterwards, both off the quoted total —
 *     campaign = floor(total × percent / 100)      (whole rupees)
 *     coupon   = the server-validated `couponAmount` prop (never recomputed here)
 *     payable  = max(0, total − campaign − coupon)
 * — so this component mirrors that last step to show the same number checkout will
 * charge, and it is applied exactly once. Option and seat prices are never derived
 * here; per-line figures are the server's own.
 *
 * Money arrives as strings (Postgres NUMERIC, toFixed(2)). Everything is coerced
 * with num() before arithmetic: `"500.00" + 100` is the string "500.00100", which
 * silently priced the order wrong whenever a coupon and a campaign were both live.
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

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const FOCUS =
  'peer-focus-visible:ring-2 peer-focus-visible:ring-glow peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-ink-900';

const CARD =
  'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition duration-200 ' +
  'motion-safe:hover:-translate-y-px hover:shadow-md motion-safe:active:scale-[0.99] sm:p-4';
const CARD_ON =
  'border-ink-800 bg-sand-50 shadow-sm ring-1 ring-ink-800 dark:border-sand-300 dark:bg-ink-800 dark:ring-sand-300';
const CARD_OFF =
  'border-sand-200 bg-white hover:border-sand-400 dark:border-ink-700 dark:bg-ink-900 dark:hover:border-ink-500';

/* Counts smoothly toward `target`; null = no value yet. Snaps on first value and for reduced motion. */
function useAnimatedNumber(target, ms = 380) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (target == null || current.current == null || reduce || current.current === target) {
      current.current = target;
      setValue(target);
      return undefined;
    }
    const from = current.current;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min((now - start) / ms, 1);
      const eased = 1 - (1 - p) ** 3;
      current.current = from + (target - from) * eased;
      setValue(current.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/* -------------------------------------------------------------------------- pieces */

function Travellers({ seatCount, max, onChange }) {
  const limit = Math.max(1, max);
  const solo = seatCount === 1;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 id="travellers-label" className="flex items-center gap-2 text-sm font-bold dark:text-sand-50">
            <Users aria-hidden="true" className="h-4 w-4 text-sand-500 dark:text-sand-300" />
            Travellers
          </h4>
          <p className="faint mt-0.5 text-xs">
            {solo ? 'Travelling solo?' : `Planning a trip with ${seatCount} travellers?`} Up to {limit} per booking.
          </p>
        </div>

        <div
          role="group"
          aria-labelledby="travellers-label"
          className="flex shrink-0 items-center gap-1 rounded-full border border-sand-200 bg-white p-1 shadow-sm dark:border-ink-600 dark:bg-ink-800"
        >
          <button
            type="button"
            onClick={() => onChange(Math.max(1, seatCount - 1))}
            disabled={seatCount <= 1}
            aria-label="One traveller fewer"
            className="grid h-11 w-11 place-items-center rounded-full text-ink-800 transition hover:bg-sand-100 motion-safe:active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent dark:text-sand-50 dark:hover:bg-ink-700"
          >
            <Minus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <output
            key={seatCount}
            aria-live="polite"
            className="min-w-[2.25rem] text-center text-xl font-black tabular-nums motion-safe:animate-[pc-pop_.22s_ease-out] dark:text-white"
          >
            {seatCount}
          </output>
          <button
            type="button"
            onClick={() => onChange(Math.min(limit, seatCount + 1))}
            disabled={seatCount >= limit}
            aria-label="One traveller more"
            className="grid h-11 w-11 place-items-center rounded-full bg-ink-800 text-sand-50 transition hover:bg-ink-700 motion-safe:active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-sand-300 dark:text-ink-900 dark:hover:bg-sand-200"
          >
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
      {seatCount >= limit && (
        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
          That’s the maximum for this booking.
        </p>
      )}
    </div>
  );
}

function Tick({ on }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition duration-200 ${
        on
          ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900'
          : 'border-sand-300 bg-transparent text-transparent dark:border-ink-500'
      }`}
    >
      <Check className={`h-3.5 w-3.5 transition duration-200 ${on ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`} strokeWidth={3.5} />
    </span>
  );
}

function PriceHint({ amount, unit = '/seat' }) {
  const price = num(amount);
  if (price > 0) {
    return (
      <span className="shrink-0 text-right">
        <span className="text-sm font-bold tabular-nums dark:text-sand-50">+{inr(price)}</span>
        {unit && <span className="faint block text-[11px] leading-none">{unit}</span>}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
      Included
    </span>
  );
}

function BooleanOption({ id, spec, checked, onChange }) {
  return (
    <label className="relative block cursor-pointer">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={`${CARD} ${checked ? CARD_ON : CARD_OFF} peer-focus-visible:outline-none ${FOCUS}`}>
        <Tick on={checked} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold dark:text-sand-50">{spec.label ?? id}</span>
          {spec.description && <span className="faint mt-0.5 block text-xs">{spec.description}</span>}
        </span>
        {num(spec.pricePerSeat) > 0 ? (
          <PriceHint amount={spec.pricePerSeat} />
        ) : (
          <span className="faint shrink-0 text-[11px] font-semibold">No extra cost</span>
        )}
      </span>
    </label>
  );
}

function EnumOption({ id, spec, value, onChange }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold dark:text-sand-50">{spec.label ?? id}</legend>
      <div className="space-y-2">
        {(spec.choices ?? []).map((choice) => {
          const active = value === choice.value;
          return (
            <label key={choice.value} className="relative block cursor-pointer">
              <input
                type="radio"
                name={`opt-${id}`}
                className="peer sr-only"
                checked={active}
                onChange={() => onChange(choice.value)}
              />
              <span className={`${CARD} ${active ? CARD_ON : CARD_OFF} peer-focus-visible:outline-none ${FOCUS}`}>
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition duration-200 ${
                    active ? 'border-ink-800 dark:border-sand-300' : 'border-sand-300 dark:border-ink-500'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full bg-ink-800 transition duration-200 dark:bg-sand-300 ${
                      active ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                    }`}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold dark:text-sand-50">{choice.label ?? choice.value}</span>
                  {choice.description && <span className="faint mt-0.5 block text-xs">{choice.description}</span>}
                </span>
                <PriceHint amount={choice.pricePerSeat} />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Row({ label, sub, amount, tone = 'base', sign = '' }) {
  const toneCls =
    tone === 'save' ? 'font-semibold text-emerald-300' : tone === 'muted' ? 'text-sand-300' : 'text-sand-50';
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="min-w-0">
        <span className={tone === 'save' ? 'font-semibold text-emerald-300' : 'text-sand-100'}>{label}</span>
        {sub && <span className="block text-[11px] leading-tight text-sand-300">{sub}</span>}
      </span>
      <span className={`shrink-0 tabular-nums ${toneCls}`}>
        {sign}
        {inr(amount)}
      </span>
    </li>
  );
}

function SummarySkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-3 motion-safe:animate-pulse">
      <span className="sr-only">Calculating your price…</span>
      {[70, 55, 62].map((w) => (
        <div key={w} className="flex justify-between gap-6">
          <span className="h-3.5 rounded bg-white/15" style={{ width: `${w}%` }} />
          <span className="h-3.5 w-14 rounded bg-white/15" />
        </div>
      ))}
      <div className="mt-5 h-11 w-2/3 rounded-xl bg-white/15" />
    </div>
  );
}

/* ------------------------------------------------------------------------- component */

export default function PriceConfigurator({
  tour,
  slotId,
  seatCount,
  onSeatCountChange,
  selected,
  onSelectedChange,
  maxSeats = 20,
  couponAmount = 0,
  discountCampaign = null,
}) {
  const [debounced, setDebounced] = useState({ seatCount, selected });

  // Every toggle would otherwise fire a quote; 250ms collapses a burst of taps.
  useEffect(() => {
    const id = setTimeout(() => setDebounced({ seatCount, selected }), 250);
    return () => clearTimeout(id);
  }, [seatCount, selected]);

  // The date can lose seats between refetches; never leave the party larger than the cap.
  useEffect(() => {
    if (maxSeats >= 1 && seatCount > maxSeats) onSeatCountChange(maxSeats);
  }, [maxSeats, seatCount, onSeatCountChange]);

  const { data, isFetching, isError, error, isPlaceholderData, refetch } = useQuery({
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

  // ---- money (server quote in, mirrored checkout arithmetic out) ----
  const baseTotal = num(data?.totalAmount);
  const percent = num(discountCampaign?.percent);
  const campaignSaving = percent > 0 ? Math.floor((baseTotal * percent) / 100) : 0;
  const couponSaving = Math.max(0, num(couponAmount));
  const totalSavings = Math.min(campaignSaving + couponSaving, baseTotal);
  const payable = Math.max(0, baseTotal - totalSavings);
  const savingsPct = baseTotal > 0 ? Math.round((totalSavings / baseTotal) * 100) : 0;

  const lines = data?.breakdown?.lines ?? [];
  const quoteSeats = data?.breakdown?.seatCount ?? seatCount;
  const updating =
    isFetching || isPlaceholderData || debounced.seatCount !== seatCount || debounced.selected !== selected;
  const shown = useAnimatedNumber(data ? payable : null);
  const hasSavings = totalSavings > 0;

  return (
    <section className="card overflow-hidden" aria-label="Price configurator">
      <style>{'@keyframes pc-pop{0%{transform:scale(.8);opacity:.4}100%{transform:scale(1);opacity:1}}'}</style>

      <div className="space-y-6 p-4 sm:p-5">
        <Travellers seatCount={seatCount} max={maxSeats} onChange={onSeatCountChange} />

        {entries.length > 0 && (
          <div className="space-y-5 border-t border-sand-100 pt-5 dark:border-ink-800">
            <h4 className="text-sm font-bold dark:text-sand-50">Customise your trip</h4>
            {entries.map(([key, spec]) => {
              if (spec.type === 'boolean') {
                return (
                  <BooleanOption
                    key={key}
                    id={key}
                    spec={spec}
                    checked={Boolean(selected[key])}
                    onChange={(v) => set(key, v)}
                  />
                );
              }
              if (spec.type === 'enum') {
                return (
                  <EnumOption
                    key={key}
                    id={key}
                    spec={spec}
                    value={selected[key] ?? spec.default}
                    onChange={(v) => set(key, v)}
                  />
                );
              }
              return null;
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ price summary */}
      <div className="bg-ink-800 p-4 text-sand-50 dark:bg-ink-950 sm:p-5" aria-label="Price summary">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sand-300">Your price</h4>
          {data && updating && !isError && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sand-300" role="status">
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              Updating
            </span>
          )}
        </div>

        {isError && !data ? (
          <div role="alert" className="mt-4 rounded-xl bg-red-500/15 p-4 text-sm text-red-100">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert aria-hidden="true" className="h-4 w-4" />
              Couldn’t get your price
            </p>
            <p className="mt-1 text-red-200/90">
              {error?.message || 'Please check your connection and try again.'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-bold hover:bg-white/25"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        ) : !data ? (
          <div className="mt-4">
            <SummarySkeleton />
          </div>
        ) : (
          <div className={`transition-opacity duration-200 ${updating ? 'opacity-60' : 'opacity-100'}`}>
            {isError && (
              <p role="alert" className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-100">
                <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Couldn’t refresh the price — this may be out of date.</span>
                <button type="button" onClick={() => refetch()} className="font-bold underline underline-offset-2">
                  Retry
                </button>
              </p>
            )}

            {/* Only when a campaign really applies — no empty promo slot otherwise. */}
            {campaignSaving > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-orange-400/15 px-3.5 py-2.5 ring-1 ring-orange-300/30">
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-orange-100">
                  <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-orange-300" />
                  <span>{discountCampaign.label ?? 'Festival offer'}</span>
                  <span className="shrink-0 rounded-full bg-orange-300 px-2 py-0.5 text-[11px] font-black text-ink-900">
                    {percent}% OFF
                  </span>
                </p>
                <p className="shrink-0 text-xs font-semibold text-orange-100">Save {inr(campaignSaving)}</p>
              </div>
            )}

            <ul className="mt-3 divide-y divide-white/10">
              {lines.map((line, i) => (
                <Row
                  key={line.key}
                  label={line.label}
                  sub={
                    num(line.perSeat) > 0 && quoteSeats > 1
                      ? `${inr(line.perSeat)} × ${quoteSeats} travellers`
                      : num(line.perSeat) > 0
                        ? `${inr(line.perSeat)} per traveller`
                        : undefined
                  }
                  amount={line.amount}
                  sign={i === 0 ? '' : '+'}
                />
              ))}
              {hasSavings && <Row label="Subtotal" amount={baseTotal} tone="muted" />}
              {campaignSaving > 0 && (
                <Row label={`${discountCampaign.label ?? 'Campaign'} (${percent}%)`} amount={campaignSaving} tone="save" sign="−" />
              )}
              {couponSaving > 0 && <Row label="Coupon discount" amount={couponSaving} tone="save" sign="−" />}
            </ul>

            <div className="mt-4 rounded-2xl bg-white/10 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sand-300">
                Total payable · {seatCount} {seatCount === 1 ? 'traveller' : 'travellers'}
              </p>
              {hasSavings && (
                <p className="mt-1 text-sm text-sand-300 line-through decoration-sand-300/70" aria-label={`Original price ${inr(baseTotal)}`}>
                  {inr(baseTotal)}
                </p>
              )}
              <p className="mt-0.5 text-4xl font-black leading-none tracking-tight tabular-nums sm:text-[2.5rem]" aria-hidden="true">
                {inr(Math.round(shown ?? payable))}
              </p>
              <span className="sr-only" aria-live="polite">
                {updating ? '' : `Total payable ${inr(payable)}`}
              </span>
              {hasSavings && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-300">
                  <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />
                  You save {inr(totalSavings)}
                  {savingsPct > 0 && ` (${savingsPct}% off)`}
                </p>
              )}
            </div>

            <p className="mt-3 text-[11px] leading-snug text-sand-300">Final amount is confirmed at checkout.</p>
          </div>
        )}
      </div>
    </section>
  );
}
