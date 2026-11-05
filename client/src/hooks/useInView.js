import { useEffect, useState } from 'react';

/*
 * Flips to true the first time `ref`'s element comes within `rootMargin` of the
 * viewport, then stays true. Used to defer heavy children (the MapLibre canvas, the
 * review thread's request) until the reader actually scrolls to them.
 */
export function useInView(ref, { rootMargin = '200px 0px' } = {}) {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    // No IntersectionObserver (very old browsers): load eagerly rather than never.
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);

  return seen;
}
