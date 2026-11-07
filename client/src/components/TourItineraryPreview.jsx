import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronIcon } from './TourBits.jsx';

const PREVIEW_DAYS = 3;

/* Collapsed by default so Quick View stays short. Real itinerary days only. */
export default function TourItineraryPreview({ days, slug, discount = null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!days?.length) return null;

  const shown = days.slice(0, PREVIEW_DAYS);
  const hidden = days.length - shown.length;

  return (
    <section aria-label="Itinerary preview">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center justify-between rounded-xl border border-sand-300 px-4 text-sm font-semibold transition hover:border-ink-800 dark:border-ink-600 dark:hover:border-sand-300"
      >
        <span>
          {open ? 'Hide itinerary' : 'View itinerary'}{' '}
          <span className="font-normal faint">
            · {days.length} {days.length === 1 ? 'day' : 'days'}
          </span>
        </span>
        <ChevronIcon className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-300 ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className={`overflow-hidden ${open ? '' : 'invisible'}`}>
          <ol className="mt-4 ml-2 space-y-4 border-l border-sand-300 pl-5 dark:border-ink-600">
            {shown.map((d) => (
              <li key={d.key} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -left-[1.72rem] top-1 h-2.5 w-2.5 rounded-full bg-ink-800 ring-4 ring-white dark:bg-sand-300 dark:ring-ink-900"
                />
                <p className="text-[11px] font-semibold uppercase tracking-wider faint">Day {d.day}</p>
                {d.title && <p className="text-sm font-semibold leading-snug">{d.title}</p>}
                {d.description && <p className="mt-0.5 line-clamp-2 text-sm muted">{d.description}</p>}
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <p className="mt-3 text-sm">
              <Link
                to={`/tours/${slug}`}
                state={{ discount }}
                className="font-medium underline underline-offset-4"
              >
                See all {days.length} days on the full tour page
              </Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}