import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarX,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  LoaderCircle,
  RefreshCw,
  Tag,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, longDate } from '../lib/format.js';

/*
 * Real-time seat calendar.
 *
 * Availability is the only number on the page that must never be stale, so this
 * query is `staleTime: 0` and refetches on an interval and on window focus. The
 * API sends `cache-control: no-store` for the same reason.
 *
 * Props (unchanged): tourId, value (the selected slot), onSelect(slot), seatCount.
 * Slot shape (unchanged): { slotId, date, isOpen, availableSeats, totalSeats,
 * heldSeats, priceModifier, hasGuide }.
 *
 * Every number on screen comes from that response. Nothing here invents scarcity:
 * "few left" is simply 1–3 seats, the progress bar is booked / held / free from the
 * API's own counts, and the "updated" time is when the last fetch actually landed.
 *
 * Dates: the API speaks plain 'YYYY-MM-DD' DATEs, so every date here is built and
 * compared in LOCAL time (localIso below). The shared toIsoDate() goes through
 * toISOString() — UTC — which in India turns local midnight on the 1st into the 31st
 * of the previous month, shifting the month bounds and "today" by a day. Display
 * still uses longDate() from lib/format.js, which parses as local time.
 */

const WEEKDAYS = [
  ['S', 'Sun', 'Sunday'],
  ['M', 'Mon', 'Monday'],
  ['T', 'Tue', 'Tuesday'],
  ['W', 'Wed', 'Wednesday'],
  ['T', 'Thu', 'Thursday'],
  ['F', 'Fri', 'Friday'],
  ['S', 'Sat', 'Saturday'],
];

const LIMITED_AT = 3; // 1–3 seats free reads as "few left"

/* Scoped keyframes. Reduced-motion users get none (the app's global rule also trims them). */
const CSS = `
@keyframes sc-next{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
@keyframes sc-prev{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
@keyframes sc-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.sc-next{animation:sc-next .24s ease-out both}
.sc-prev{animation:sc-prev .24s ease-out both}
.sc-rise{animation:sc-rise .28s ease-out both}
@media (prefers-reduced-motion:reduce){.sc-next,.sc-prev,.sc-rise{animation:none}}
`;

/* -------------------------------------------------------------------- date helpers */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m is 0-based
const localIso = (date) => ymd(date.getFullYear(), date.getMonth(), date.getDate());
const parseIso = (iso) => new Date(`${iso}T00:00:00`);

function monthBounds(cursor) {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { from: ymd(y, m, 1), to: ymd(y, m, lastDay), first: new Date(y, m, 1), lastDay };
}

/* ----------------------------------------------------------------------- cell state */

/*
 * One place decides what a day is, so the colour, the label, the aria text and the
 * "can I click it" answer can't drift apart.
 *   past · none (no departure) · closed · full · short (fewer seats than the party
 *   needs) · limited (1–3 left) · open
 */
function describe(iso, slot, today, seatCount) {
  if (iso < today) return { state: 'past', bookable: false, label: '', aria: 'past date' };
  if (!slot) return { state: 'none', bookable: false, label: '', aria: 'no departure' };
  if (!slot.isOpen) {
    return { state: 'closed', bookable: false, label: 'Closed', aria: 'not open for booking' };
  }
  const left = Number(slot.availableSeats);
  if (left <= 0) return { state: 'full', bookable: false, label: 'Full', aria: 'fully booked' };
  const free = `${left} of ${slot.totalSeats} seats free`;
  if (left < seatCount) {
    return {
      state: 'short',
      bookable: false,
      label: `${left} left`,
      aria: `only ${left} ${left === 1 ? 'seat' : 'seats'} free, you need ${seatCount}`,
    };
  }
  if (left <= LIMITED_AT) {
    return { state: 'limited', bookable: true, label: `${left} left`, aria: `${free}, few left` };
  }
  return { state: 'open', bookable: true, label: `${left} left`, aria: free };
}

const TONE = {
  open:
    'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 hover:shadow-md motion-safe:hover:-translate-y-0.5 ' +
    'dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-100 dark:hover:bg-emerald-500/20',
  limited:
    'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100 hover:shadow-md motion-safe:hover:-translate-y-0.5 ' +
    'dark:border-orange-400/35 dark:bg-orange-500/10 dark:text-orange-100 dark:hover:bg-orange-500/20',
  full: 'cursor-not-allowed border-transparent bg-sand-100 text-sand-700 dark:bg-ink-800 dark:text-sand-300/80',
  short:
    'cursor-not-allowed border-dashed border-sand-300 bg-transparent text-sand-700 dark:border-ink-600 dark:text-sand-300/80',
  closed:
    'cursor-not-allowed border-transparent bg-sand-50 text-sand-600 dark:bg-ink-800/60 dark:text-sand-300/70',
  none: 'cursor-not-allowed border-transparent bg-transparent text-sand-400 dark:text-ink-500',
  past: 'cursor-not-allowed border-transparent bg-transparent text-sand-300 dark:text-ink-600',
};

const SELECTED =
  'border-ink-800 bg-ink-800 text-sand-50 shadow-lg shadow-ink-800/30 ring-2 ring-ink-800 ring-offset-2 ring-offset-white ' +
  'motion-safe:scale-[1.04] dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900 dark:ring-sand-300 dark:ring-offset-ink-900';

const SELECTED_STALE =
  'border-red-300 bg-red-50 text-red-800 ring-2 ring-red-400 ring-offset-2 ring-offset-white ' +
  'dark:border-red-400/40 dark:bg-red-950/50 dark:text-red-200 dark:ring-offset-ink-900';

/* --------------------------------------------------------------------- small pieces */

function LiveBadge({ isError, isFetching, isPending, updatedAt }) {
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : null;

  let dot = <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulseGlow" />;
  let text = time ? `Live · ${time}` : 'Live';
  if (isError) {
    dot = <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500" />;
    text = time ? `Offline · last ${time}` : 'Offline';
  } else if (isPending) {
    dot = <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />;
    text = 'Checking seats';
  } else if (isFetching) {
    dot = <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />;
    text = 'Updating';
  }

  return (
    <p
      title="Seat counts refresh automatically every 30 seconds"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sand-200 bg-sand-50 px-2.5 py-1 text-[11px] font-semibold text-ink-700 dark:border-ink-600 dark:bg-ink-800 dark:text-sand-200"
    >
      {dot}
      <span className="whitespace-nowrap">{text}</span>
    </p>
  );
}

function NavButton({ dir, onClick, disabled, label }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-sand-300 bg-white text-ink-800 shadow-sm transition hover:bg-sand-100 motion-safe:active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:border-ink-600 dark:bg-ink-800 dark:text-sand-50 dark:hover:bg-ink-700 dark:disabled:hover:bg-ink-800"
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}

function Legend() {
  const items = [
    ['Available', 'border-emerald-300 bg-emerald-100 dark:border-emerald-400/40 dark:bg-emerald-500/25'],
    ['Few seats left', 'border-orange-300 bg-orange-100 dark:border-orange-400/40 dark:bg-orange-500/25'],
    ['Fully booked', 'border-transparent bg-sand-200 dark:bg-ink-700'],
    ['Unavailable', 'border-dashed border-sand-300 bg-transparent dark:border-ink-500'],
  ];
  return (
    <ul
      aria-label="Calendar legend"
      className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-sand-100 pt-4 text-xs text-ink-700 dark:border-ink-700 dark:text-sand-200 sm:flex sm:flex-wrap sm:gap-x-5"
    >
      {items.map(([label, swatch]) => (
        <li key={label} className="flex items-center gap-2">
          <span aria-hidden="true" className={`h-4 w-4 shrink-0 rounded-md border ${swatch}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}

function SkeletonGrid() {
  return (
    <div role="status" aria-busy="true" className="mt-1 grid grid-cols-7 gap-1 sm:gap-1.5">
      <span className="sr-only">Loading seat availability…</span>
      {Array.from({ length: 35 }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="min-h-[3.25rem] animate-pulse rounded-xl bg-sand-100 motion-reduce:animate-none dark:bg-ink-800 sm:min-h-[4rem]"
        />
      ))}
    </div>
  );
}

function StatePanel({ icon: Icon, title, children, tone = 'neutral' }) {
  const toneCls =
    tone === 'error'
      ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
      : 'bg-sand-50 text-ink-800 dark:bg-ink-800 dark:text-sand-100';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`sc-rise flex flex-col items-center gap-2 rounded-2xl px-5 py-10 text-center ${toneCls}`}
    >
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white/70 dark:bg-white/10">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </span>
      <p className="text-base font-bold">{title}</p>
      <div className="max-w-xs text-sm opacity-90">{children}</div>
    </div>
  );
}

function Notice({ tone = 'warn', icon: Icon, children, action }) {
  const cls =
    tone === 'error'
      ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
      : tone === 'info'
        ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200'
        : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100';
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={`mt-3 flex items-start gap-2.5 rounded-xl p-3 text-xs sm:text-sm ${cls}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------- summary card */

function SelectedSummary({ slot }) {
  const total = Number(slot.totalSeats) || 0;
  const free = Math.max(Number(slot.availableSeats) || 0, 0);
  const held = Math.max(Number(slot.heldSeats) || 0, 0);
  const booked = Math.max(total - free - held, 0);
  const pct = (n) => (total > 0 ? `${Math.min((n / total) * 100, 100)}%` : '0%');

  const mod = Number(slot.priceModifier) || 0;
  const priceLine =
    mod > 0
      ? `+${inr(mod)} per seat · date surcharge`
      : mod < 0
        ? `−${inr(Math.abs(mod))} per seat · date discount`
        : 'No date surcharge';

  const few = free > 0 && free <= LIMITED_AT;

  return (
    <div
      key={slot.slotId}
      className="sc-rise mt-4 overflow-hidden rounded-2xl bg-ink-800 p-4 text-sand-50 shadow-lg ring-1 ring-black/5 dark:ring-white/10 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sand-300">
            <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-300" />
            Your departure
          </p>
          <p className="mt-1 text-lg font-black leading-tight sm:text-xl">{longDate(slot.date)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            few ? 'bg-orange-400/20 text-orange-200' : 'bg-emerald-400/15 text-emerald-200'
          }`}
        >
          {few ? 'Few seats left' : 'Seats available'}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Available', free],
          ['Total', total],
          ['On hold', held],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl bg-white/10 px-2 py-2.5">
            <dt className="text-[10px] font-medium uppercase tracking-wider text-sand-300 sm:text-[11px]">{label}</dt>
            <dd className="mt-0.5 text-xl font-black tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>

      {/* booked · held · free, straight from the API counts */}
      <div aria-hidden="true" className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10">
        <span className="bg-sand-400/80" style={{ width: pct(booked) }} />
        <span className="bg-orange-400" style={{ width: pct(held) }} />
        <span className="bg-emerald-400" style={{ width: pct(free) }} />
      </div>
      {held > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-sand-300">
          {held} {held === 1 ? 'seat is' : 'seats are'} held by travellers checking out right now. Held seats are released
          if they don’t complete payment.
        </p>
      )}

      <ul className="mt-4 space-y-2 border-t border-white/10 pt-3 text-sm">
        <li className="flex items-center gap-2.5">
          <UserCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-sand-300" />
          {slot.hasGuide ? 'Guide assigned' : 'Guide not assigned yet'}
        </li>
        <li className="flex items-center gap-2.5">
          <Tag aria-hidden="true" className="h-4 w-4 shrink-0 text-sand-300" />
          {priceLine}
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------ component */

export default function SeatCalendar({ tourId, value, onSelect, seatCount = 1 }) {
  // Re-open on the selected date's month (the panel remounts between rail and sheet).
  const [cursor, setCursor] = useState(() => {
    const base = value?.date ? parseIso(value.date) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [dir, setDir] = useState(null);
  const [focusIso, setFocusIso] = useState(null);
  const cellRefs = useRef(new Map());

  const { from, to, first, lastDay } = useMemo(() => monthBounds(cursor), [cursor]);
  const todayDate = new Date();
  const today = localIso(todayDate);
  const thisMonthFirst = ymd(todayDate.getFullYear(), todayDate.getMonth(), 1);

  const { data, isPending, isError, error, isFetching, refetch, dataUpdatedAt } = useQuery({
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
    for (let d = 1; d <= lastDay; d += 1) out.push(ymd(first.getFullYear(), first.getMonth(), d));
    return out;
  }, [first, lastDay]);

  const info = useMemo(() => {
    const map = new Map();
    for (const iso of cells) if (iso) map.set(iso, describe(iso, byDate.get(iso), today, seatCount));
    return map;
  }, [cells, byDate, today, seatCount]);

  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const nextMonthLabel = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
  });

  const go = useCallback((delta) => {
    setDir(delta > 0 ? 'next' : 'prev');
    setFocusIso(null);
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }, []);
  const canGoPrev = from > thisMonthFirst;

  /* ---- what the loaded month tells us */
  const loaded = Boolean(data) && !isPending;
  const hasDepartures = (data?.dates?.length ?? 0) > 0;
  const bookableCount = [...info.values()].filter((x) => x.bookable).length;
  const shortCount = [...info.values()].filter((x) => x.state === 'short').length;
  const showGrid = !isPending && !(isError && !data) && !(loaded && !hasDepartures);

  /* ---- the selected slot, as the latest fetch sees it */
  const inThisMonth = Boolean(value?.date) && value.date >= from && value.date <= to;
  const liveValue = value ? (inThisMonth && loaded ? byDate.get(value.date) ?? null : value) : null;
  let staleMessage = null;
  if (value && inThisMonth && loaded) {
    if (!liveValue) staleMessage = 'This departure is no longer listed. Please choose another date.';
    else if (!liveValue.isOpen) staleMessage = 'This departure is no longer open for booking. Please choose another date.';
    else if (liveValue.availableSeats <= 0) staleMessage = 'This date has just sold out. Please choose another departure.';
    else if (liveValue.availableSeats < seatCount) {
      staleMessage = `Only ${liveValue.availableSeats} ${
        liveValue.availableSeats === 1 ? 'seat is' : 'seats are'
      } left on this date, but you’re booking ${seatCount}. Reduce travellers or pick another date.`;
    }
  }

  /* ---- keyboard: arrows move between bookable dates, PageUp/Down change month */
  const anchor = (() => {
    if (focusIso && info.get(focusIso)?.bookable) return focusIso;
    if (value?.date && info.get(value.date)?.bookable) return value.date;
    for (const iso of cells) if (iso && info.get(iso)?.bookable) return iso;
    return null;
  })();

  const onGridKeyDown = (e) => {
    const iso = e.target?.dataset?.iso;
    if (!iso) return;
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (e.key === 'PageDown') go(1);
      else if (canGoPrev) go(-1);
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const edge = e.key === 'Home' ? 1 : e.key === 'End' ? -1 : 0;
    if (!step && !edge) return;
    e.preventDefault();

    const focusAt = (i) => {
      const target = cells[i];
      const el = target && info.get(target)?.bookable ? cellRefs.current.get(target) : null;
      if (!el) return false;
      el.focus();
      return true;
    };
    if (edge) {
      const order = edge === 1 ? cells.map((_, i) => i) : cells.map((_, i) => cells.length - 1 - i);
      for (const i of order) if (focusAt(i)) return;
      return;
    }
    for (let i = cells.indexOf(iso) + step; i >= 0 && i < cells.length; i += step) {
      if (focusAt(i)) return;
    }
  };

  const setRef = (iso) => (el) => {
    if (el) cellRefs.current.set(iso, el);
    else cellRefs.current.delete(iso);
  };

  return (
    <section className="card overflow-hidden" aria-label="Departure calendar">
      <style>{CSS}</style>

      {/* ---------------------------------------------------------------- header */}
      <header className="border-b border-sand-100 bg-gradient-to-b from-sand-50 to-white p-4 dark:border-ink-700 dark:from-ink-800 dark:to-ink-900 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-black leading-tight tracking-tight sm:text-xl">Select Your Departure Date</h3>
            <p className="faint mt-0.5 text-xs sm:text-sm">Choose your preferred travel date.</p>
          </div>
          <LiveBadge isError={isError} isFetching={isFetching} isPending={isPending} updatedAt={dataUpdatedAt} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <NavButton dir="prev" label="Previous month" onClick={() => go(-1)} disabled={!canGoPrev} />
          <p aria-live="polite" className="text-center text-base font-bold tracking-tight sm:text-lg">
            {monthLabel}
          </p>
          <NavButton dir="next" label="Next month" onClick={() => go(1)} />
        </div>
      </header>

      <div className="p-3 sm:p-5">
        {isError && data && (
          <Notice
            tone="error"
            icon={TriangleAlert}
            action={
              <button type="button" onClick={() => refetch()} className="shrink-0 font-bold underline underline-offset-2">
                Retry
              </button>
            }
          >
            Couldn’t refresh seat counts, so these may be out of date.
          </Notice>
        )}

        {/* ------------------------------------------------------------- weekdays */}
        <div className={`${isError && data ? 'mt-3' : ''} grid grid-cols-7 gap-1 text-center sm:gap-1.5`}>
          {WEEKDAYS.map(([short, mid, full], i) => (
            <span
              key={`${full}-${i}`}
              className="py-1 text-[11px] font-semibold uppercase tracking-wider text-sand-600 dark:text-sand-300/80"
            >
              <span aria-hidden="true">
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{mid}</span>
              </span>
              <span className="sr-only">{full}</span>
            </span>
          ))}
        </div>

        {/* ----------------------------------------------------------------- body */}
        {isPending && <SkeletonGrid />}

        {isError && !data && (
          <StatePanel icon={TriangleAlert} tone="error" title="Couldn’t load seat availability">
            <p>{error?.message || 'Something went wrong.'}</p>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn-primary mt-4 w-full sm:w-auto"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              {isFetching ? 'Retrying…' : 'Try again'}
            </button>
          </StatePanel>
        )}

        {loaded && !hasDepartures && (
          <StatePanel icon={CalendarX} title={`No departures in ${monthLabel}`}>
            <p>There are no scheduled departures this month.</p>
            <button type="button" onClick={() => go(1)} className="btn-primary mt-4 w-full sm:w-auto">
              View {nextMonthLabel}
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </StatePanel>
        )}

        {showGrid && (
          <div
            key={from}
            role="group"
            aria-label={`Dates in ${monthLabel}`}
            onKeyDown={onGridKeyDown}
            className={`mt-1 grid grid-cols-7 gap-1 sm:gap-1.5 ${dir === 'next' ? 'sc-next' : dir === 'prev' ? 'sc-prev' : ''}`}
          >
            {cells.map((iso, i) => {
              if (!iso) return <span key={`blank-${i}`} aria-hidden="true" />;
              const slot = byDate.get(iso);
              const d = info.get(iso);
              const isSelected = Boolean(slot) && value?.slotId === slot.slotId;
              const isToday = iso === today;
              const stale = isSelected && !d.bookable;

              return (
                <button
                  key={iso}
                  ref={setRef(iso)}
                  data-iso={iso}
                  type="button"
                  disabled={!d.bookable}
                  tabIndex={iso === anchor ? 0 : -1}
                  onFocus={() => setFocusIso(iso)}
                  onClick={() => onSelect(slot)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={`${longDate(iso)}, ${d.aria}${isSelected ? ', selected' : ''}`}
                  title={d.state === 'short' ? `Only ${slot.availableSeats} free, you need ${seatCount}` : undefined}
                  className={[
                    'relative flex min-h-[3.25rem] flex-col items-center justify-center rounded-xl border px-0.5 py-1 text-center',
                    'transition duration-200 sm:min-h-[4rem]',
                    stale ? SELECTED_STALE : isSelected ? SELECTED : TONE[d.state],
                  ].join(' ')}
                >
                  <span className="text-sm font-bold leading-none tabular-nums sm:text-base">{Number(iso.slice(-2))}</span>
                  {d.label && (
                    <span className="mt-1 max-w-full truncate text-[10px] font-medium leading-none sm:text-[11px]">
                      {stale ? 'Unavailable' : d.label}
                    </span>
                  )}
                  {isSelected && !stale && (
                    <Check aria-hidden="true" className="absolute right-0.5 top-0.5 h-2.5 w-2.5" strokeWidth={3.5} />
                  )}
                  {d.state === 'limited' && !isSelected && (
                    <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-orange-500" />
                  )}
                  {isToday && (
                    <span
                      aria-hidden="true"
                      className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-current opacity-60"
                      title="Today"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ----------------------------------------------------------- guidance */}
        {loaded && hasDepartures && bookableCount === 0 && (
          <Notice
            tone="info"
            icon={Info}
            action={
              <button type="button" onClick={() => go(1)} className="shrink-0 font-bold underline underline-offset-2">
                {nextMonthLabel}
              </button>
            }
          >
            {shortCount > 0
              ? `No date this month has ${seatCount} seats free. Try fewer travellers or another month.`
              : 'No dates with seats left this month. Try another month.'}
          </Notice>
        )}
        {loaded && bookableCount > 0 && shortCount > 0 && (
          <p className="faint mt-3 text-xs">
            Dashed dates have fewer than {seatCount} seats free, so they can’t be booked for your group.
          </p>
        )}

        <Legend />

        {/* ------------------------------------------------------------- summary */}
        {staleMessage && (
          <Notice tone="warn" icon={TriangleAlert}>
            {staleMessage}
          </Notice>
        )}
        {liveValue?.slotId && !staleMessage && <SelectedSummary slot={liveValue} />}

        <p className="sr-only" role="status">
          {value?.date && !staleMessage
            ? `Selected ${longDate(value.date)}. ${(liveValue ?? value).availableSeats} of ${
                (liveValue ?? value).totalSeats
              } seats free.`
            : ''}
        </p>
      </div>
    </section>
  );
}
