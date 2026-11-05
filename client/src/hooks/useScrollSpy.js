import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './useMediaQuery.js';

/*
 * Height of the app shell's sticky top bar (Layout's `header.sticky`). It changes —
 * the guest banner adds a line — so it is measured, not hard-coded, and exposed to
 * CSS as `--hdr` so sticky tabs and scroll margins always clear it.
 */
export function useStickyHeaderHeight(fallback = 64) {
  const [height, setHeight] = useState(fallback);

  useEffect(() => {
    const el = document.querySelector('header.sticky');
    if (!el) return undefined;
    const update = () => setHeight(Math.ceil(el.getBoundingClientRect().height));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return height;
}

/*
 * Scroll-spy for a page that is one long scroll with a sticky section nav. Returns
 * the section currently under the sticky bars plus a `scrollToSection` that also
 * pins the highlight for the duration of the smooth scroll (otherwise the nav would
 * flicker through every section it passes).
 */
export function useScrollSpy(ids, getOffset) {
  const [active, setActive] = useState(ids[0]);
  const lockUntil = useRef(0);
  const offsetRef = useRef(getOffset);
  offsetRef.current = getOffset;
  const key = ids.join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    let frame = 0;

    const compute = () => {
      frame = 0;
      if (Date.now() < lockUntil.current || !list.length) return;
      const line = offsetRef.current() + 12;
      let current = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = list[list.length - 1];
      setActive(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [key]);

  const scrollToSection = useCallback((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = prefersReducedMotion();
    lockUntil.current = Date.now() + (reduce ? 50 : 800);
    setActive(id);
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  return { active, scrollToSection };
}
