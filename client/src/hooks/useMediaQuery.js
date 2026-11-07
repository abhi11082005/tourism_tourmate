import { useEffect, useState } from 'react';

/*
 * Subscribes to a CSS media query. Used where *mounting* differs by breakpoint —
 * a screen with stateful children (a calendar, a route planner) renders them in the
 * desktop panel OR the mobile sheet, never both with one hidden by CSS.
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
