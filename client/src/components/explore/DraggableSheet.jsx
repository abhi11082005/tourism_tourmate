import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/*
 * Mobile bottom sheet with three snap points (peek / half / full), drag via pointer
 * events on the handle, and a button fallback (tap to cycle, Arrow keys) so it never
 * depends on dragging. Height is a % of the map region, so it respects whatever
 * viewport / safe area the page gives it; content scrolls inside, nothing overflows.
 */
const SNAPS = { peek: 0, half: 0.5, full: 0.82 };
const ORDER = ['peek', 'half', 'full'];

export default function DraggableSheet({ state, onState, title, subtitle, peekContent, children }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [dragH, setDragH] = useState(null);


  const onPointerDown = (e) => {
    const parentH = ref.current?.parentElement?.clientHeight ?? 600;
    drag.current = { y: e.clientY, h: ref.current.getBoundingClientRect().height, parentH, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setDragH(Math.max(96, Math.min(d.parentH * SNAPS.full, d.h + dy)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]);
    } else {
      const ratio = (dragH ?? d.h) / d.parentH;
      onState(ratio < 0.3 ? 'peek' : ratio < 0.68 ? 'half' : 'full');
    }
    setDragH(null);
  };
  const onKeyDown = (e) => {
    const i = ORDER.indexOf(state);
    if (e.key === 'ArrowUp') (e.preventDefault(), onState(ORDER[Math.min(2, i + 1)]));
    if (e.key === 'ArrowDown') (e.preventDefault(), onState(ORDER[Math.max(0, i - 1)]));
  };

  const style = dragH != null ? { height: dragH } : state === 'peek' ? undefined : { height: `${SNAPS[state] * 100}%` };
  const expanded = state !== 'peek';

  return (
    <div
      ref={ref}
      style={{ ...style, paddingBottom: 'env(safe-area-inset-bottom)' }}
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl border-t border-sand-200 bg-white shadow-2xl dark:border-ink-600 dark:bg-ink-900 ${
        dragH == null ? 'transition-[height] duration-300' : ''
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${title}. ${expanded ? 'Collapse' : 'Expand'} results`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setDragH(null); }}
        onKeyDown={onKeyDown}
        className="flex w-full shrink-0 touch-none select-none flex-col items-center gap-1 px-4 pb-2 pt-2 text-left"
      >
        <span className="h-1.5 w-12 rounded-full bg-sand-300 dark:bg-ink-600" aria-hidden />
        <span className="flex w-full items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-black">{title}</span>
            <span className="faint block text-xs">{subtitle}</span>
          </span>
          {expanded ? <ChevronDown className="h-5 w-5 shrink-0" aria-hidden /> : <ChevronUp className="h-5 w-5 shrink-0" aria-hidden />}
        </span>
      </button>
      {expanded ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div> : peekContent}
    </div>
  );
}
