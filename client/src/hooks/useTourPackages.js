import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export const PAGE_SIZE = 6;

/*
 * Real server-side pagination for the Tour packages grid.
 *
 * - Each page is a separate request: limit=6&offset=0, then offset=6, 12, ...
 * - The query key includes `q` and `sort`, so changing either starts a fresh
 *   list at offset 0 (and old lists stay cached under their own key).
 * - The next offset is the server's own `offset + items.length`, and fetching
 *   stops once that reaches the server's `total`.
 * - Cards are de-duplicated by id in case a tour is inserted between requests.
 */
export function useTourPackages({ q, sort }) {
  const query = useInfiniteQuery({
    queryKey: ['tour-packages', { q: q ?? '', sort }],
    initialPageParam: 0,
    staleTime: 60_000,
    // Same as the old list: keep showing the previous results while a new
    // search/sort loads, instead of flashing skeletons on every keystroke.
    placeholderData: (prev) => prev,
    queryFn: ({ pageParam, signal }) =>
      api.listTours({ q, sort, limit: PAGE_SIZE, offset: pageParam }, signal),
    getNextPageParam: (lastPage) => {
      const count = lastPage?.items?.length ?? 0;
      const next = (lastPage?.offset ?? 0) + count;
      return count > 0 && next < (lastPage?.total ?? 0) ? next : undefined;
    },
  });

  const items = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const page of query.data?.pages ?? []) {
      for (const tour of page.items ?? []) {
        if (!seen.has(tour.id)) {
          seen.add(tour.id);
          out.push(tour);
        }
      }
    }
    return out;
  }, [query.data]);

  const total = query.data?.pages?.at(-1)?.total ?? 0;

  return { ...query, items, total };
}