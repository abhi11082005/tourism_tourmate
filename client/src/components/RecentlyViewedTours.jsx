import { Link } from 'react-router-dom';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed.js';
import { CloseIcon, CoverFallback, durationLabel } from './TourBits.jsx';
import { inr } from '../lib/format.js';

/* Horizontal rail of tours the visitor opened before. Hidden when empty. */
export default function RecentlyViewedTours({ discountFor }) {
  const { items, remove, clear } = useRecentlyViewed();
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="recent-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="recent-heading" className="text-lg font-bold">
          Recently viewed
        </h2>
        <button
          type="button"
          onClick={clear}
          className="min-h-11 px-2 text-sm faint underline-offset-4 hover:underline"
        >
          Clear all
        </button>
      </div>

      <ul className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {items.map((t) => {
          const duration = durationLabel(t);
          const discount = discountFor?.(t.base_price) ?? null;
          return (
            <li key={t.id} className="card group relative w-56 shrink-0 snap-start overflow-hidden">
              <Link to={`/tours/${t.slug}`} state={{ discount }} className="block">
                <div className="relative aspect-[3/2] overflow-hidden bg-sand-100 dark:bg-ink-800">
                  {t.cover_url ? (
                    <img
                      src={t.cover_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition duration-500 motion-safe:group-hover:scale-105"
                    />
                  ) : (
                    <CoverFallback title={t.title} />
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug">{t.title}</p>
                  <p className="mt-1 text-xs faint">
                    {duration}
                    {duration && t.base_price != null && ' · '}
                    {t.base_price != null && `from ${inr(t.base_price)}`}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label={`Remove ${t.title} from recently viewed`}
                className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-ink-900 shadow backdrop-blur transition hover:bg-white dark:bg-ink-900/90 dark:text-sand-50"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}