import { ArrowIcon } from './TourBits.jsx';

/*
 * Progress + "Discover more" control. All numbers come from the server's
 * `total` and the number of tours actually loaded.
 */
export default function LoadMoreTours({ shown, total, hasMore, loading, error, onLoadMore }) {
  if (!total) return null;
  const pct = Math.min(100, Math.round((shown / total) * 100));

  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 text-center">
      <p className="text-sm text-ink-700 dark:text-sand-300" aria-live="polite">
        Showing <strong>{shown}</strong> of <strong>{total}</strong> experiences
      </p>

      <div className="flex w-full items-center gap-3">
        <div
          role="progressbar"
          aria-label="Tours loaded"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={shown}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand-100 dark:bg-ink-700"
        >
          <div
            className="h-full rounded-full bg-ink-800 transition-[width] duration-500 dark:bg-sand-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-sand-500 dark:text-sand-400">
          {shown} / {total}
        </span>
      </div>

      {error && (
        <p className="notice-error" role="alert">
          Couldn’t load more tours. Your current results are still here.
        </p>
      )}

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          aria-busy={loading}
          className="btn-primary group mt-1 min-w-52"
        >
          {loading ? (
            <>
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
              />
              Loading…
            </>
          ) : (
            <>
              {error ? 'Try again' : 'Discover more tours'}
              <ArrowIcon className="h-4 w-4 rotate-90 transition-transform group-hover:translate-y-0.5" />
            </>
          )}
        </button>
      ) : (
        <p className="text-sm font-medium text-ink-800 dark:text-sand-100">
          You’ve explored all available journeys!
        </p>
      )}
    </div>
  );
}