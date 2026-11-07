import { useCallback, useMemo, useState } from 'react';

export const MAX_COMPARE = 3;

/*
 * Compare selection. Keeps the already-loaded tour objects (no extra API call),
 * so a selection survives Load More, sorting and searching.
 */
export function useCompare() {
  const [selected, setSelected] = useState([]);

  const toggle = useCallback((tour) => {
    setSelected((prev) => {
      if (prev.some((t) => t.id === tour.id)) return prev.filter((t) => t.id !== tour.id);
      return prev.length >= MAX_COMPARE ? prev : [...prev, tour];
    });
  }, []);
  const remove = useCallback((id) => setSelected((p) => p.filter((t) => t.id !== id)), []);
  const clear = useCallback(() => setSelected([]), []);
  const ids = useMemo(() => new Set(selected.map((t) => t.id)), [selected]);

  return { selected, ids, toggle, remove, clear, full: selected.length >= MAX_COMPARE };
}