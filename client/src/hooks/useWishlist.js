import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, auth } from '../lib/api.js';

/*
 * Wraps the existing wishlist endpoints (api.wishlist / api.toggleWishlist).
 *
 * If TourMate already has a wishlist hook or context, use that instead and pass
 * its `savedIds`, `toggle` and `pendingId` to the cards: the card only needs
 * those three things.
 *
 * ASSUMPTION: GET /social/wishlist returns either an array or { items | tours },
 * whose entries carry the tour id as `tour_id`, `tourId` or `id`. Adjust
 * `idOf` below if your response differs.
 */
const idOf = (entry) => entry?.tour_id ?? entry?.tourId ?? entry?.id;

export function useWishlist() {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const timer = useRef(null);

  const flash = useCallback((message) => {
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const list = useQuery({
    queryKey: ['wishlist'],
    queryFn: ({ signal }) => api.wishlist(signal),
    enabled: Boolean(auth.token),
  });

  const savedIds = useMemo(() => {
    const data = list.data;
    const entries = Array.isArray(data) ? data : (data?.items ?? data?.tours ?? []);
    return new Set(entries.map(idOf).filter(Boolean));
  }, [list.data]);

  const mutation = useMutation({
    mutationFn: (tourId) => api.toggleWishlist(tourId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['wishlist'] });
      setPendingId(null);
    },
    onError: (err) =>
      flash(
        err?.status === 401
          ? 'Please sign in to save tours.'
          : 'Couldn’t update your wishlist. Please try again.'
      ),
  });

  // `mutate` is stable, so `toggle` is too, which keeps memoised cards from
  // re-rendering when unrelated state changes.
  const { mutate } = mutation;
  const busy = useRef(false);
  busy.current = mutation.isPending;

  const toggle = useCallback(
    (tourId) => {
      if (!auth.token) {
        flash('Please sign in to save tours.');
        return;
      }
      if (busy.current) return;
      setPendingId(tourId);
      mutate(tourId);
    },
    [flash, mutate]
  );

  return { savedIds, pendingId, toggle, notice };
}