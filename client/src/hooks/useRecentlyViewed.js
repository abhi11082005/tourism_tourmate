import { useCallback, useEffect, useSyncExternalStore } from 'react';

/*
 * Recently viewed tours, kept in localStorage so it works for guests.
 *
 * Only non-sensitive display fields are stored. A tiny external store keeps
 * every consumer (the Home rail, the detail page recorder) in sync, including
 * across browser tabs via the `storage` event.
 */
const KEY = 'tourmate.recentTours';
export const MAX_RECENT = 8;

const EMPTY = [];
const listeners = new Set();
let cache = null;

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((t) => t && t.id && t.slug) : [];
  } catch {
    return [];
  }
}

function write(list) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: the list still works for this session in memory */
  }
  listeners.forEach((l) => l());
}

const getSnapshot = () => (cache ??= read());

function subscribe(onChange) {
  listeners.add(onChange);
  const onStorage = (e) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Most recent first, no duplicates, capped at MAX_RECENT. */
export function recordRecentlyViewed(tour) {
  if (!tour?.id || !tour?.slug) return;
  const entry = {
    id: tour.id,
    slug: tour.slug,
    title: tour.title,
    cover_url: tour.cover_url ?? null,
    base_price: tour.base_price ?? null,
    duration_days: tour.duration_days ?? null,
    duration_nights: tour.duration_nights ?? null,
    viewedAt: Date.now(),
  };
  write([entry, ...getSnapshot().filter((t) => t.id !== entry.id)].slice(0, MAX_RECENT));
}

/** Call from the tour detail page with the loaded tour. */
export function useRecordRecentlyViewed(tour) {
  const id = tour?.id;
  useEffect(() => {
    if (tour) recordRecentlyViewed(tour);
    // Record once per tour, not on every re-render of the detail page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}

export function useRecentlyViewed() {
  const items = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const remove = useCallback((id) => write(getSnapshot().filter((t) => t.id !== id)), []);
  const clear = useCallback(() => write([]), []);
  return { items, remove, clear };
}