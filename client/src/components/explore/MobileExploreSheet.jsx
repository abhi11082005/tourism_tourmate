import { useEffect, useRef, useState } from 'react';
import { GLASS } from './exploreConfig.js';

/*
 * Draggable-style bottom sheet for phones and tablets. No dependencies.
 *
 *  - Two resting states. COLLAPSED shows the "peek": grab handle, mode switcher and a
 *    one-glance preview (destination, route stats, or a hint) so the map stays the
 *    hero. EXPANDED reveals the full planner, which scrolls inside the sheet.
 *  - The handle is a real button (tap / Enter toggles) that also tracks pointer drags;
 *    releasing past a threshold snaps to the other state. Only the handle drags, so the
 *    planner's own scrolling never fights the gesture.
 *  - While collapsed, the planner is `inert`: it cannot be tabbed into or read by a
 *    screen reader while it is slid out of view.
 *  - The peek height is measured, not hard-coded, because the preview row changes.
 *  - Bottom padding honours the safe-area inset.
 */

const SNAP_PX = 60;
const MOVED_PX = 6;

export default function MobileExploreSheet({ expanded, onExpandedChange, switcher, preview, children }) {
  const sheetRef = useRef(null);
  const headRef = useRef(null);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const [peek, setPeek] = useState(190);
  const [dragDy, setDragDy] = useState(null);

  useEffect(() => {
    const el = headRef.current;
    if (!el) return undefined;
    const update = () => setPeek(Math.ceil(el.getBoundingClientRect().height));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    suppressClick.current = false;
    const sheetHeight = sheetRef.current?.getBoundingClientRect().height ?? 0;
    drag.current = { startY: event.clientY, max: Math.max(0, sheetHeight - peek), moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d) return;
    const raw = event.clientY - d.startY;
    if (Math.abs(raw) > MOVED_PX) d.moved = true;
    if (!d.moved) return;
    // Expanded can only be pulled down, collapsed only pushed up, and never past the ends.
    setDragDy(expanded ? Math.min(d.max, Math.max(0, raw)) : Math.max(-d.max, Math.min(0, raw)));
  };

  const onPointerUp = (event) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      suppressClick.current = true; // the click that follows a drag is not a tap
      const raw = event.clientY - d.startY;
      if (expanded && raw > SNAP_PX) onExpandedChange(false);
      else if (!expanded && raw < -SNAP_PX) onExpandedChange(true);
    }
    setDragDy(null);
  };

  const onPointerCancel = () => {
    drag.current = null;
    setDragDy(null);
  };

  const onHandleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onExpandedChange(!expanded);
  };

  const base = expanded ? '0px' : `calc(100% - ${peek}px)`;

  return (
    <div
      ref={sheetRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.stopPropagation();
          onExpandedChange(false);
        }
      }}
      className={`absolute inset-x-0 bottom-0 z-10 mx-auto flex max-h-[85%] w-full max-w-xl flex-col rounded-t-3xl transition-transform duration-300 ease-out ${GLASS}`}
      style={{
        transform: `translateY(calc(${base} + ${dragDy ?? 0}px))`,
        transition: dragDy != null ? 'none' : undefined,
      }}
    >
      <div ref={headRef} className="shrink-0">
        <button
          type="button"
          onClick={onHandleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          aria-expanded={expanded}
          aria-controls="explore-sheet-body"
          aria-label={expanded ? 'Collapse planner' : 'Expand planner'}
          className="flex h-8 w-full cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        >
          <span aria-hidden className="h-1.5 w-11 rounded-full bg-sand-300 dark:bg-ink-500" />
        </button>

        <div className="space-y-3 px-4 pb-2">
          {switcher}
          {preview}
        </div>

        <p className="faint pb-1.5 text-center text-[10px]">
          Map data ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            OpenStreetMap contributors
          </a>
        </p>
      </div>

      <div
        id="explore-sheet-body"
        aria-hidden={!expanded}
        inert={expanded ? undefined : ''}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-sand-200/70 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 dark:border-ink-600/70"
      >
        {children}
      </div>
    </div>
  );
}
