import { useEffect, useState } from 'react';

/*
 * Subscribes to a CSS media query. Used where *mounting* differs by breakpoint —
 * the booking panel must exist exactly once (it owns a calendar, a coupon box and a
 * debounced price quote), so it is rendered in the desktop rail OR the mobile sheet,
 * never both with one of them hidden by CSS.
 */
const read = (query) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => read(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const prefersReducedMotion = () => read('(prefers-reduced-motion: reduce)');
