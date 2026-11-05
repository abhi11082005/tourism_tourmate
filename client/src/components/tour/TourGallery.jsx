import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  Heart,
  Images,
  Share2,
  X,
} from 'lucide-react';
import { prefersReducedMotion } from '../../hooks/useMediaQuery.js';

/*
 * Hero gallery.
 *
 *  - md+   : one featured image + up to three supporting tiles, "View all" button.
 *  - phones: a full-bleed, swipeable (scroll-snap) carousel with a counter and
 *            prev/next controls — the way a native travel app shows a hero.
 *  - both  : tap/click opens a fullscreen viewer (arrow keys, swipe, thumbnails,
 *            Esc, focus trapped and restored).
 *
 * It renders `tour.gallery` exactly as it arrives; with no photos it falls back to
 * the same "no photos yet" notice the page always had.
 */

const roundBtn =
  'grid h-11 w-11 place-items-center rounded-full bg-white/90 text-ink-800 shadow-md backdrop-blur ' +
  'transition hover:bg-white disabled:opacity-60 md:h-10 md:w-10 dark:bg-ink-900/85 dark:text-sand-50 dark:hover:bg-ink-900';

function PhotoViewer({ images, startIndex, title, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const closeRef = useRef(null);
  const rootRef = useRef(null);
  const touchX = useRef(null);
  const total = images.length;

  const go = useCallback((delta) => setIndex((i) => (i + delta + total) % total), [total]);

  useEffect(() => {
    const returnTo = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });

    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') go(1);
      else if (event.key === 'ArrowLeft') go(-1);
      else if (event.key === 'Tab' && rootRef.current) {
        const nodes = [...rootRef.current.querySelectorAll('button:not([disabled])')];
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
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (returnTo && typeof returnTo.focus === 'function') returnTo.focus({ preventScroll: true });
    };
  }, [go, onClose]);

  const current = images[index];

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} photo gallery`}
      className="fixed inset-0 z-[60] flex flex-col bg-ink-950/95 text-white"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm font-semibold tabular-nums" aria-live="polite">
          {index + 1} / {total}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close gallery"
          className="grid h-11 w-11 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 md:px-16"
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      >
        <img
          key={current.url}
          src={current.url}
          alt={current.alt ?? `${title} — photo ${index + 1}`}
          className="max-h-full max-w-full rounded-xl object-contain"
          decoding="async"
        />
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 md:grid"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 md:grid"
            >
              <ChevronRight className="h-6 w-6" aria-hidden />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <ul className="flex shrink-0 gap-2 overflow-x-auto px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:justify-center">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                className={`block overflow-hidden rounded-lg ring-2 transition ${
                  i === index ? 'ring-glow' : 'opacity-60 ring-transparent hover:opacity-100'
                }`}
              >
                <img
                  src={img.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-14 w-20 object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body
  );
}

function Tile({ img, index, title, className, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      aria-label={`Open photo ${index + 1}`}
      className={`group relative block overflow-hidden bg-sand-100 dark:bg-ink-800 ${className}`}
    >
      <img
        src={img.url}
        alt={img.alt ?? (index === 0 ? title : '')}
        loading={index === 0 ? 'eager' : 'lazy'}
        // Lowercase on purpose: React 18 does not know the camelCase prop yet.
        {...(index === 0 ? { fetchpriority: 'high' } : {})}
        decoding="async"
        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
      />
      <span className="absolute inset-0 bg-ink-950/0 transition group-hover:bg-ink-950/10" aria-hidden />
    </button>
  );
}

export default function TourGallery({
  images,
  title,
  isSaved,
  savePending,
  onToggleSave,
  onShare,
  shareNote,
  onBack,
}) {
  const [viewerAt, setViewerAt] = useState(null);
  const [slide, setSlide] = useState(0);
  const scrollerRef = useRef(null);
  const frame = useRef(0);
  const total = images.length;

  const openViewer = useCallback((i) => setViewerAt(i), []);
  const closeViewer = useCallback(() => setViewerAt(null), []);

  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scrollerRef.current;
      if (el && el.clientWidth) setSlide(Math.round(el.scrollLeft / el.clientWidth));
    });
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const goSlide = (delta) => {
    const el = scrollerRef.current;
    if (!el) return;
    const next = Math.min(total - 1, Math.max(0, slide + delta));
    el.scrollTo({ left: next * el.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const supporting = images.slice(1, 4);
  const tileClass = (i) => {
    if (supporting.length === 1) return 'col-span-2 row-span-2';
    if (supporting.length === 2) return 'col-span-2 row-span-1';
    return i === 2 ? 'col-span-2 row-span-1' : 'col-span-1 row-span-1';
  };

  const actions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleSave}
        disabled={savePending}
        aria-pressed={isSaved}
        aria-label={isSaved ? 'Remove from wishlist' : 'Save to wishlist'}
        className={roundBtn}
      >
        <Heart
          className={`h-5 w-5 transition ${
            isSaved ? 'scale-110 fill-red-500 text-red-500' : ''
          }`}
          aria-hidden
        />
      </button>
      <button type="button" onClick={onShare} aria-label="Share this tour" className={roundBtn}>
        <Share2 className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );

  const note = shareNote && (
    <p
      role="status"
      className="absolute right-4 top-16 z-10 rounded-full bg-ink-900/90 px-3 py-1.5 text-xs font-semibold text-sand-50 shadow-lg"
    >
      {shareNote}
    </p>
  );

  if (!total) {
    return (
      <section aria-label="Photos" className="relative -mx-4 -mt-4 md:mx-0 md:mt-0">
        <div className="grid aspect-[4/3] place-items-center bg-sand-100 text-center text-sm text-sand-500 md:aspect-[16/6] md:rounded-3xl dark:bg-ink-800">
          <span className="flex flex-col items-center gap-2">
            <Camera className="h-6 w-6" aria-hidden />
            Admin hasn&apos;t uploaded photos yet
          </span>
        </div>
        <div className="absolute left-4 top-4 md:hidden">
          <button type="button" onClick={onBack} aria-label="Go back" className={roundBtn}>
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="absolute right-4 top-4">{actions}</div>
        {note}
      </section>
    );
  }

  return (
    <section aria-label="Photos" className="relative -mx-4 -mt-4 md:mx-0 md:mt-0">
      {/* ── Phones: swipeable hero ─────────────────────────────────────────── */}
      <div className="relative md:hidden">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          tabIndex={0}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${title} photos`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') goSlide(1);
            if (e.key === 'ArrowLeft') goSlide(-1);
          }}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((img, i) => (
            <button
              key={`${img.url}-${i}`}
              type="button"
              onClick={() => openViewer(i)}
              aria-label={`Open photo ${i + 1} of ${total}`}
              className="block shrink-0 basis-full snap-center bg-sand-100 dark:bg-ink-800"
            >
              <img
                src={img.url}
                alt={img.alt ?? (i === 0 ? title : '')}
                loading={i === 0 ? 'eager' : 'lazy'}
                {...(i === 0 ? { fetchpriority: 'high' } : {})}
                decoding="async"
                className="aspect-[4/3] w-full object-cover"
              />
            </button>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-ink-950/35 to-transparent" aria-hidden />

        {total > 1 && (
          <>
            {slide > 0 && (
              <button
                type="button"
                onClick={() => goSlide(-1)}
                aria-label="Previous photo"
                className={`${roundBtn} absolute left-3 top-1/2 -translate-y-1/2`}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
            )}
            {slide < total - 1 && (
              <button
                type="button"
                onClick={() => goSlide(1)}
                aria-label="Next photo"
                className={`${roundBtn} absolute right-3 top-1/2 -translate-y-1/2`}
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            )}
          </>
        )}

        <p
          className="absolute bottom-3 right-3 rounded-full bg-ink-950/70 px-3 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur"
          aria-live="polite"
        >
          {Math.min(slide + 1, total)} / {total}
        </p>

        <div className="absolute left-4 top-4">
          <button type="button" onClick={onBack} aria-label="Go back" className={roundBtn}>
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* ── md+: featured image and supporting tiles ───────────────────────── */}
      <div className="relative hidden h-[420px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-3xl md:grid lg:h-[500px]">
        <Tile
          img={images[0]}
          index={0}
          title={title}
          onOpen={openViewer}
          className={supporting.length ? 'col-span-2 row-span-2' : 'col-span-4 row-span-2'}
        />
        {supporting.map((img, i) => (
          <Tile
            key={`${img.url}-${i}`}
            img={img}
            index={i + 1}
            title={title}
            onOpen={openViewer}
            className={tileClass(i)}
          />
        ))}

        {total > 1 && (
          <button
            type="button"
            onClick={() => openViewer(0)}
            className="absolute bottom-4 right-4 inline-flex min-h-10 items-center gap-2 rounded-full bg-white/95 px-4 text-sm font-semibold text-ink-800 shadow-lg backdrop-blur transition hover:bg-white dark:bg-ink-900/90 dark:text-sand-50"
          >
            <Images className="h-4 w-4" aria-hidden />
            View all {total} photos
          </button>
        )}
      </div>

      <div className="absolute right-4 top-4 z-10">{actions}</div>
      {note}

      {viewerAt != null && (
        <PhotoViewer images={images} startIndex={viewerAt} title={title} onClose={closeViewer} />
      )}
    </section>
  );
}
