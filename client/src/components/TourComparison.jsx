import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MAX_COMPARE } from '../hooks/useCompare.js';
import { inr } from '../lib/format.js';
import { CloseIcon, CoverFallback, durationLabel, formatTourType, ratingOf } from './TourBits.jsx';

const NA = <span className="text-sand-500 dark:text-sand-400">Not available</span>;
const has = (v) => v !== null && v !== undefined && v !== '';

/* Only values the list API actually returned; anything else says "Not available". */
const ROWS = [
  ['Tour type', (t) => (has(t.tour_type) ? <span className="capitalize">{formatTourType(t.tour_type)}</span> : NA)],
  ['Duration', (t) => durationLabel(t) ?? NA],
  [
    'Starting price',
    (t, d) =>
      d ? (
        <span>
          <strong>{inr(d.discounted)}</strong>{' '}
          <s className="text-xs text-sand-500 dark:text-sand-400">{inr(d.original)}</s>
          <span className="block text-[11px] font-semibold text-glow">
            {d.percent}% off · {d.label}
          </span>
        </span>
      ) : has(t.base_price) ? (
        <strong>{inr(t.base_price)}</strong>
      ) : (
        NA
      ),
  ],
  ['Maximum price', (t) => (has(t.max_price) ? inr(t.max_price) : NA)],
  ['Rating', (t) => (ratingOf(t) ? `${ratingOf(t).toFixed(1)} / 5` : NA)],
  ['Reviews', (t) => (has(t.review_count) ? String(t.review_count) : NA)],
];

function ComparePanel({ selected, onRemove, onClear, discountFor, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  // Nothing left to compare: close instead of showing an empty table.
  useEffect(() => {
    if (selected.length === 0) onClose();
  }, [selected.length, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="compare-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto max-h-[90vh] w-[min(96vw,60rem)] flex-col overflow-hidden rounded-2xl border border-sand-100 bg-white p-0 text-ink-900 shadow-2xl open:flex backdrop:bg-black/60 backdrop:backdrop-blur-sm dark:border-ink-600 dark:bg-ink-900 dark:text-sand-50"
    >
      <div className="flex items-center justify-between gap-3 border-b border-sand-100 p-4 dark:border-ink-600">
        <h2 id="compare-title" className="text-lg font-bold">
          Compare tours{' '}
          <span className="text-sm font-normal faint">
            ({selected.length} of {MAX_COMPARE})
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClear} className="btn-ghost min-h-10">
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            className="grid h-10 w-10 place-items-center rounded-full hover:bg-sand-100 dark:hover:bg-ink-800"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrolls sideways inside the dialog, never the page. */}
      <div className="overflow-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">Side-by-side comparison of the selected tours</caption>
          <thead>
            <tr>
              <td className="sticky left-0 z-10 w-28 bg-white dark:bg-ink-900" />
              {selected.map((t) => (
                <th key={t.id} scope="col" className="min-w-44 p-3 align-top font-normal">
                  <div className="relative aspect-[3/2] overflow-hidden rounded-xl bg-sand-100 dark:bg-ink-800">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <CoverFallback title={t.title} />
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 font-semibold leading-snug">{t.title}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, render]) => (
              <tr key={label} className="border-t border-sand-100 dark:border-ink-700">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-white p-3 text-xs font-medium uppercase tracking-wide faint dark:bg-ink-900"
                >
                  {label}
                </th>
                {selected.map((t) => (
                  <td key={t.id} className="p-3 align-top">
                    {render(t, discountFor?.(t.base_price) ?? null)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-sand-100 dark:border-ink-700">
              <th scope="row" className="sticky left-0 z-10 bg-white dark:bg-ink-900" />
              {selected.map((t) => (
                <td key={t.id} className="p-3 align-top">
                  <div className="flex flex-col gap-2">
                    <Link
                      to={`/tours/${t.slug}`}
                      state={{ discount: discountFor?.(t.base_price) ?? null }}
                      className="btn-primary min-h-10"
                    >
                      View tour
                    </Link>
                    <button type="button" onClick={() => onRemove(t.id)} className="btn-ghost min-h-10">
                      Remove
                    </button>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </dialog>
  );
}

/* Floating selection bar + the comparison dialog. Renders nothing until a tour is picked. */
export default function TourComparison({ selected, onRemove, onClear, discountFor }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (selected.length === 0) return null;

  const canCompare = selected.length >= 2;

  return (
    <>
      <div
        role="region"
        aria-label="Tour comparison"
        className="card fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-col gap-3 p-3 shadow-xl sm:flex-row sm:items-center"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" aria-live="polite">
            {selected.length} of {MAX_COMPARE} selected
            {!canCompare && <span className="font-normal faint"> · pick one more to compare</span>}
          </p>
          <ul className="mt-2 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {selected.map((t) => (
              <li
                key={t.id}
                className="flex shrink-0 items-center gap-1 rounded-full border border-sand-300 py-1 pl-1 pr-1 dark:border-ink-600"
              >
                <span className="h-7 w-7 overflow-hidden rounded-full bg-sand-100 dark:bg-ink-800">
                  {t.cover_url && <img src={t.cover_url} alt="" className="h-full w-full object-cover" />}
                </span>
                <span className="max-w-32 truncate text-xs">{t.title}</span>
                <button
                  type="button"
                  onClick={() => onRemove(t.id)}
                  aria-label={`Remove ${t.title} from comparison`}
                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-sand-100 dark:hover:bg-ink-800"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClear} className="btn-ghost flex-1 sm:flex-none">
            Clear
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!canCompare}
            className="btn-primary flex-1 sm:flex-none"
          >
            Compare
          </button>
        </div>
      </div>

      {open && (
        <ComparePanel
          selected={selected}
          onRemove={onRemove}
          onClear={onClear}
          discountFor={discountFor}
          onClose={close}
        />
      )}
    </>
  );
}