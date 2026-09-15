import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { ago, stamp } from '../../lib/format.js';
import { Empty, ErrorNote, Loading, SectionHeader } from '../../components/ui.jsx';

/*
 * Review history: every review and every comment, newest first.
 *
 * The server returns them pre-merged from one UNION ALL query, so the filter here
 * is a view over an already-sorted list rather than two lists being interleaved in
 * the browser — which is what makes "load more" possible later without the
 * ordering going wrong.
 */

const FILTERS = [
  ['ALL', 'Everything'],
  ['REVIEW', 'Reviews'],
  ['COMMENT', 'Comments'],
];

export default function Reviews() {
  const [filter, setFilter] = useState('ALL');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['activity', 100],
    queryFn: ({ signal }) => api.activity({ limit: 100 }, signal),
    staleTime: 60_000,
  });

  if (isPending) return <Loading label="Loading what you have written…" />;
  if (isError) return <ErrorNote error={error} />;

  const all = data.activity ?? [];
  const items = filter === 'ALL' ? all : all.filter((a) => a.kind === filter);
  const reviewCount = all.filter((a) => a.kind === 'REVIEW').length;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Reviews & comments"
        hint={
          all.length === 0
            ? 'Everything you write on a tour is collected here.'
            : `${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'} and ${
                all.length - reviewCount
              } ${all.length - reviewCount === 1 ? 'comment' : 'comments'}.`
        }
      />

      {all.length === 0 ? (
        <Empty
          title="You haven't written anything yet"
          hint="Reviews help other travellers pick a tour — and they are the fastest way to remember your own."
          actionTo="/"
          actionLabel="Browse tours"
        />
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Filter by type"
            className="flex gap-1 rounded-xl border border-sand-300 p-0.5 dark:border-ink-600"
          >
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  filter === value
                    ? 'bg-ink-800 text-sand-50 dark:bg-sand-200 dark:text-ink-900'
                    : 'hover:bg-sand-100 dark:hover:bg-ink-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <p className="muted py-6 text-center text-sm">
              Nothing of that kind yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((a) => (
                <li key={`${a.kind}-${a.id}`} className="card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">
                      <Link to={`/tours/${a.tourSlug}`} className="hover:underline">
                        {a.tourTitle}
                      </Link>
                    </p>
                    <p className="faint text-xs" title={stamp(a.createdAt)}>
                      {ago(a.createdAt)}
                    </p>
                  </div>

                  <p className="mt-1 flex items-center gap-2 text-xs">
                    <span className="chip bg-sand-100 dark:bg-ink-800">
                      {a.kind === 'REVIEW' ? 'review' : 'comment'}
                    </span>
                    {a.rating != null && (
                      <span className="text-amber-600 dark:text-amber-300">
                        <span aria-hidden>{'★'.repeat(a.rating)}{'☆'.repeat(5 - a.rating)}</span>
                        <span className="sr-only">{a.rating} out of 5</span>
                      </span>
                    )}
                    {a.likeCount > 0 && (
                      <span className="faint">
                        {a.likeCount} {a.likeCount === 1 ? 'like' : 'likes'}
                      </span>
                    )}
                  </p>

                  <p className="mt-2 whitespace-pre-line text-sm">{a.content}</p>

                  <p className="mt-3">
                    <Link
                      to={`/tours/${a.tourSlug}#reviews`}
                      className="faint text-xs underline"
                    >
                      {a.kind === 'REVIEW' ? 'See it on the tour page' : 'See the thread'}
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
