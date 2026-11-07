import { useEffect, useRef, useState } from 'react';
import AssistantPanel from './AssistantPanel.jsx';

/*
 * Floating round button. Click it and the "Ask the expert" chat opens as a
 * popup with the suggestion chips as the first options.
 *
 * Drag the button anywhere; when you let go it glides to the nearer SIDE of the
 * screen (left or right) and sticks there, at whatever height you dropped it.
 * It never docks to the top or bottom edge, can never go under the site header
 * (HEADER_H below), and the dock position is remembered between visits.
 *
 * The popup opens on whichever side of the button has more room, and is sized
 * to fit, so it never slides under the header or off the screen.
 *
 * Clicking anywhere outside the popup and the button (or pressing Esc) closes
 * it, and the icon rotates back to its original position.
 *
 * The icon is a plain <img>, served from client/public/assistant-icon.svg.
 *
 * The panel stays mounted while closed, so the conversation (and a streaming
 * answer) is not lost when the popup is closed and reopened.
 */

const ICON_SRC = '/assistant-icon.svg';

const MARGIN = 16; // gap from the left / right / bottom screen edge
const HEADER_H = 80; // height of the site header the button must stay below
const TOP_LIMIT = HEADER_H + 8; // lowest-up position (top of the button)
const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag
const POPUP_GAP = 12;
const POPUP_MAX_H = 480; // 30rem
const POPUP_MAX_W = 384; // 24rem
const STORAGE_KEY = 'tourmate.assistant.dock';
const EDGES = ['l', 'r']; // anything else saved by an older version is ignored
const DEFAULT_DOCK = { edge: 'r', ratio: 1 }; // right edge, bottom of the range

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

// Determine dynamic size based on viewport width (36px for mobile, 64px otherwise)
const getButtonSize = (vpWidth) => (vpWidth < 768 ? 36 : 64);

function readDock() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && EDGES.includes(saved.edge) && Number.isFinite(saved.ratio)) {
      return { edge: saved.edge, ratio: clamp(saved.ratio, 0, 1) };
    }
  } catch {
    /* fall through to the default */
  }
  return DEFAULT_DOCK;
}

function saveDock(dock) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dock));
  } catch {
    /* storage unavailable — the position just won't be remembered */
  }
}

// The range the button's top-left corner may occupy, for a given viewport.
function bounds(vp, size) {
  const minX = MARGIN;
  const maxX = Math.max(minX, vp.w - size - MARGIN);
  const minY = TOP_LIMIT;
  const maxY = Math.max(minY, vp.h - size - MARGIN);
  return { minX, maxX, minY, maxY };
}

function dockXY(dock, vp, size) {
  const { minX, maxX, minY, maxY } = bounds(vp, size);
  const r = clamp(dock.ratio, 0, 1);
  return { x: dock.edge === 'l' ? minX : maxX, y: minY + r * (maxY - minY) };
}

// Which side is closer to where the button was dropped, and how far down it sits.
function nearestDock(pos, vp, size) {
  const { minY, maxY } = bounds(vp, size);
  const edge = pos.x + size / 2 < vp.w / 2 ? 'l' : 'r';
  const along = (pos.y - minY) / (maxY - minY || 1);
  return { edge, ratio: clamp(along, 0, 1) };
}

export default function AssistantLauncher({ tourId, tourTitle }) {
  const [open, setOpen] = useState(false);
  const [dock, setDock] = useState(readDock);
  const [dragPos, setDragPos] = useState(null); // {x, y} while dragging, else null
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });

  const rootRef = useRef(null);
  const dragRef = useRef(null);
  const lastPosRef = useRef(null);
  const justDraggedRef = useRef(false);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => e.key === 'Escape' && setOpen(false);

    // pointerdown covers mouse, touch and pen. The root wraps both the popup and
    // the round button, so clicks on either never count as "outside" (the button
    // keeps handling its own toggle).
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const size = getButtonSize(vp.w);

  const onButtonPointerDown = (e) => {
    if (e.button !== 0) return;
    justDraggedRef.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onButtonPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setOpen(false); // keep the popup out of the way while moving
    }
    // The top limit keeps the button out of the header while dragging, too.
    const pos = {
      x: clamp(d.originX + dx, 0, window.innerWidth - size),
      y: clamp(d.originY + dy, TOP_LIMIT, Math.max(TOP_LIMIT, window.innerHeight - size)),
    };
    lastPosRef.current = pos;
    setDragPos(pos);
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!d?.moved) return; // it was a plain click; onClick handles it

    justDraggedRef.current = true; // swallow the click that follows a drag
    const pos = lastPosRef.current ?? { x: d.originX, y: d.originY };
    const next = nearestDock(pos, { w: window.innerWidth, h: window.innerHeight }, size);
    setDock(next);
    saveDock(next);
    setDragPos(null); // releases the inline position, so the button glides to the edge
  };

  const onButtonClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setOpen((v) => !v);
  };

  const target = dragPos ?? dockXY(dock, vp, size);

  // Popup geometry: open on the side with more room, aligned toward the screen
  // centre, and sized so it stays below the header and inside the viewport.
  const spaceAbove = target.y - TOP_LIMIT - POPUP_GAP;
  const spaceBelow = vp.h - (target.y + size) - MARGIN - POPUP_GAP;
  const above = spaceAbove >= spaceBelow;
  const popupH = Math.min(POPUP_MAX_H, Math.max(above ? spaceAbove : spaceBelow, 200));
  const popupW = Math.min(POPUP_MAX_W, vp.w - MARGIN * 2);
  const alignRight = target.x + size / 2 > vp.w / 2;
  const rawLeft = alignRight ? target.x + size - popupW : target.x;
  const popupLeft = clamp(rawLeft, MARGIN, Math.max(MARGIN, vp.w - popupW - MARGIN)) - target.x;

  return (
    <div
      ref={rootRef}
      className="fixed z-50"
      style={{
        left: target.x,
        top: target.y,
        width: size,
        height: size,
        transition: dragPos ? 'none' : 'left 300ms ease, top 300ms ease',
      }}
    >
      <div
        id="assistant-popup"
        role="dialog"
        aria-label="Ask the expert"
        aria-hidden={!open}
        className={`absolute transition duration-200 ${
          open ? 'scale-100 opacity-100' : 'pointer-events-none invisible scale-95 opacity-0'
        }`}
        style={{
          width: popupW,
          height: popupH,
          left: popupLeft,
          ...(above
            ? { bottom: '100%', marginBottom: POPUP_GAP }
            : { top: '100%', marginTop: POPUP_GAP }),
          transformOrigin: `${alignRight ? 'right' : 'left'} ${above ? 'bottom' : 'top'}`,
        }}
      >
        <AssistantPanel tourId={tourId} tourTitle={tourTitle} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          tabIndex={open ? 0 : -1}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-sand-500 hover:bg-white/10"
        >
          ×
        </button>
      </div>

      <button
        type="button"
        onClick={onButtonClick}
        onPointerDown={onButtonPointerDown}
        onPointerMove={onButtonPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-expanded={open}
        aria-controls="assistant-popup"
        aria-label={open ? 'Close the expert chat' : 'Ask the expert'}
        className="h-full w-full cursor-grab touch-none select-none overflow-hidden rounded-full shadow-lg ring-1 ring-white/10 transition-shadow hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sand-500 active:cursor-grabbing"
      >
        <img
          src={ICON_SRC}
          alt=""
          draggable="false"
          className={`h-full w-full object-contain transition-transform duration-500 ease-in-out ${
            open ? 'rotate-90' : 'rotate-0'
          }`}
        />
      </button>
    </div>
  );
}