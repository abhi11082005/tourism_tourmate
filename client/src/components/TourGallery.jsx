import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, CoverFallback } from './TourBits.jsx';

/*
 * Image browser for Quick View. `images` is already de-duplicated (cover first)
 * and comes from data the parent has; this component never fetches anything,
 * so browsing is just swapping <img> sources.
 */
const Chevron = ({ dir, className }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={dir === 'left' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
  </svg>
);

const navBtn =
  'absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink-900 shadow backdrop-blur transition hover:bg-white motion-safe:active:scale-90 dark:bg-ink-900/90 dark:text-sand-50';

export default function TourGallery({ images, title }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(() => new Set());
  const [lightbox, setLightbox] = useState(false);
  const touchX = useRef(null);
  const count = images.length;
  const multi = count > 1;

  // If the list shrinks (new data), keep the index valid.
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  const go = useCallback(
    (delta) => setIndex((i) => (count ? (i + delta + count) % count : 0)),
    [count]
  );

  // Lightbox: Escape closes only the lightbox (not the whole dialog); arrows browse.
  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setLightbox(false);
      } else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [lightbox, go]);

  const markFailed = (src) => setFailed((s) => new Set(s).add(src));
  const current = images[index];
  const currentOk = current && !failed.has(current);

  const onTouchStart = (e) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e) => {
    if (touchX.current == null || !multi) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={`${title} photos`}
      onKeyDown={(e) => {
        if (!multi || lightbox) return;
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
      }}
    >
      <div
        className="relative aspect-[16/10] overflow-hidden bg-sand-100 dark:bg-ink-800"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {currentOk ? (
          <img
            key={current}
            src={current}
            alt={`${title}, photo ${index + 1} of ${count}`}
            decoding="async"
            onError={() => markFailed(current)}
            className="h-full w-full object-cover"
          />
        ) : (
          <CoverFallback title={title} />
        )}

        {/* Click target for the larger preview; arrows are siblings, not children. */}
        {currentOk && (
          <button
            type="button"
            onClick={() => setLightbox(true)}
            aria-label="Open larger image"
            className="absolute inset-0 cursor-zoom-in"
          />
        )}

        {multi && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className={`${navBtn} left-3`}>
              <Chevron dir="left" className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className={`${navBtn} right-3`}>
              <Chevron dir="right" className="h-5 w-5" />
            </button>
            <span
              className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur"
              aria-live="polite"
            >
              {index + 1} / {count}
            </span>
          </>
        )}
      </div>

      {multi && (
        <ul className="hidden gap-2 overflow-x-auto p-3 pb-0 [scrollbar-width:none] sm:flex [&::-webkit-scrollbar]:hidden">
          {images.map((src, i) => (
            <li key={src} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === index}
                className={`block h-14 w-20 overflow-hidden rounded-lg border-2 bg-sand-100 transition dark:bg-ink-800 ${
                  i === index
                    ? 'border-ink-800 dark:border-sand-300'
                    : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                {!failed.has(src) && (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => markFailed(src)}
                    className="h-full w-full object-cover"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightbox && currentOk && (
        <div
          role="dialog"
          aria-label={`${title} photo viewer`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(false)}
        >
          <img
            src={current}
            alt={`${title}, photo ${index + 1} of ${count}`}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="Close larger image"
            className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
          {multi && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                aria-label="Previous photo"
                className="absolute left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25"
              >
                <Chevron dir="left" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
                aria-label="Next photo"
                className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25"
              >
                <Chevron dir="right" className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}