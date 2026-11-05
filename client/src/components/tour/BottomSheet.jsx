import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/*
 * Generic modal bottom sheet (booking, assistant).
 *
 * - Children mount on first open and then STAY mounted. The booking sheet holds a
 *   calendar cursor, a typed coupon and an applied discount; unmounting on close
 *   would silently throw those away.
 * - Slide animation is CSS only. `visibility` is part of the transition, so the
 *   sheet stays visible for the whole slide-out and is then removed from the tab
 *   order and the accessibility tree.
 * - Focus moves into the sheet on open, is trapped while open, and returns to the
 *   element that opened it. Esc, the backdrop and the close button all dismiss.
 * - Bottom padding honours env(safe-area-inset-bottom); content scrolls inside
 *   the sheet, never behind it (body scroll is locked while open).
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function BottomSheet({ open, onClose, title, children }) {
  const [everOpened, setEverOpened] = useState(open);
  const [shown, setShown] = useState(false);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocus = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  // Two frames: the first paints the closed position, the second flips to open so
  // the browser has a "from" state to animate away from on the very first open.
  useEffect(() => {
    if (!open) {
      setShown(false);
      return undefined;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    returnFocus.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const target = returnFocus.current;
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  // Focus only once the panel is actually visible: while it is still sliding in from
  // `visibility: hidden` the browser refuses focus, so this waits for it.
  useEffect(() => {
    if (!open || !shown) return undefined;
    const id = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, [open, shown]);

  if (!everOpened) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 transition-[visibility] duration-300 ${
        shown ? 'visible' : 'invisible pointer-events-none'
      }`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-ink-950/50 backdrop-blur-[2px] transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full flex-col overflow-hidden
                    rounded-t-3xl border-t border-sand-200 bg-white shadow-2xl transition-transform
                    duration-300 ease-out dark:border-ink-600 dark:bg-ink-900 md:max-w-lg ${
                      shown ? 'translate-y-0' : 'translate-y-full'
                    }`}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-sand-300 dark:bg-ink-600" aria-hidden />
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-2">
          <h2 id={titleId} className="text-lg font-black tracking-tight">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="grid h-11 w-11 place-items-center rounded-full text-ink-700 transition hover:bg-sand-100
                       dark:text-sand-200 dark:hover:bg-ink-800"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* min-h-0 + flex-1 lets the child own its own scroll region and footer. */}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>,
    document.body
  );
}
