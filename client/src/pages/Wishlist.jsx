import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import TourCard from '../components/TourCard.jsx';
import { Empty, ErrorNote, Loading, SectionHeader } from '../components/ui.jsx';

/*
 * Saved tours — a dashboard module, reachable at /dashboard/saved.
 *
 * The toggle is optimistic: un-hearting a card should feel instant even on a slow
 * connection, and the worst case is a card reappearing on error.
 */

export default function Wishlist() {
  const qc = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['wishlist'],
    queryFn: ({ signal }) => api.wishlist(signal),
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: (tourId) => api.toggleWishlist(tourId),
    onMutate: async (tourId) => {
      await qc.cancelQueries({ queryKey: ['wishlist'] });
      const previous = qc.getQueryData(['wishlist']);
      qc.setQueryData(['wishlist'], (old) =>
        old ? { ...old, items: old.items.filter((t) => t.id !== tourId) } : old
      );
      return { previous };
    },
    onError: (_err, _tourId, ctx) => qc.setQueryData(['wishlist'], ctx?.previous),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['wishlist'] });
      // Keeps the "Saved" badge in the dashboard rail honest.
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  if (isPending) return <Loading label="Loading saved tours…" />;
  if (isError) return <ErrorNote error={error} />;

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Saved trips"
        hint={
          items.length
            ? `${items.length} tour${items.length === 1 ? '' : 's'} on your list.`
            : 'Your bookmarks, ready when you are.'
        }
      />

      {items.length === 0 ? (
        <Empty
          title="Nothing saved yet"
          hint="Tap ♡ on any tour to keep it here."
          actionTo="/"
          actionLabel="Browse tours"
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((tour) => (
            <li key={tour.id}>
              <TourCard tour={tour} saved onToggleSave={toggle.mutate} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
