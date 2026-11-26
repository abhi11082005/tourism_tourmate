import { useState } from 'react';
import { ArrowUpDown, SlidersHorizontal } from 'lucide-react';
import { SORTS, activeFilterCount } from '../../lib/placeFilters.js';

const RATINGS = [0, 3, 3.5, 4, 4.5];
const PRICES = [
  [null, 'Any'],
  [1, '₹'],
  [2, '₹₹'],
  [3, '₹₹₹'],
];

/*
 * Sort + Google-only filters. Radius and category live elsewhere; this never changes
 * the selected category. Rating/price/open-now apply to Google places only (TourMate
 * picks carry no such data), and unrated places are listed last, never as 0 or 5.
 */
export default function SortFilter({ sort, onSort, filters, onFilters, hiddenUnrated }) {
  const [open, setOpen] = useState(false);
  const n = activeFilterCount(filters);
  const set = (patch) => onFilters({ ...filters, ...patch });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Sort places</span>
          <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" aria-hidden />
          <select value={sort} onChange={(e) => onSort(e.target.value)} className="field h-9 w-full pl-8 text-xs">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost min-h-9 gap-1.5 px-3 text-xs"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Filters{n > 0 ? ` (${n})` : ''}
        </button>
      </div>

      {open && (
        <div className="space-y-3 rounded-xl border border-sand-200 p-3 text-xs dark:border-ink-600">
          <div>
            <p className="faint mb-1 font-bold uppercase tracking-wide">Minimum rating</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Minimum rating">
              {RATINGS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={filters.minRating === r}
                  onClick={() => set({ minRating: r })}
                  className={`chip min-h-8 px-2.5 text-xs ${filters.minRating === r ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900' : ''}`}
                >
                  {r === 0 ? 'Any' : `${r}+`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="faint mb-1 font-bold uppercase tracking-wide">Price level</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Maximum price level">
              {PRICES.map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={filters.maxPrice === v}
                  onClick={() => set({ maxPrice: v })}
                  className={`chip min-h-8 px-2.5 text-xs ${filters.maxPrice === v ? 'border-ink-800 bg-ink-800 text-sand-50 dark:border-sand-300 dark:bg-sand-300 dark:text-ink-900' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={filters.openNow} onChange={(e) => set({ openNow: e.target.checked })} />
            Open now (only places with known hours)
          </label>
          {n > 0 && (
            <button type="button" className="font-semibold underline" onClick={() => onFilters({ minRating: 0, openNow: false, maxPrice: null })}>
              Clear filters
            </button>
          )}
        </div>
      )}
      {hiddenUnrated > 0 && (
        <p className="faint text-[11px]">{hiddenUnrated} place{hiddenUnrated === 1 ? '' : 's'} without a Google rating hidden by the rating filter.</p>
      )}
    </div>
  );
}
