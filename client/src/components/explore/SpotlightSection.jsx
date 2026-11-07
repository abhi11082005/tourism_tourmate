import { useState } from 'react';
import { ArrowUpRight, Camera } from 'lucide-react';
import { SECTION_LABEL } from './exploreConfig.js';

/*
 * Spotlight discovery cards. Data-agnostic on purpose: it renders whatever list it is
 * handed ({ id, title, city, image }) and reports the clicked `id`. Today that list is
 * sample data, so the section says so (`isSample`); once a real endpoint exists the page
 * passes the fetched list with isSample={false} and nothing here changes.
 *
 *  layout="rail"   : floating photo cards over the map (desktop).
 *  layout="inline" : scroll-snap row inside the mobile sheet.
 */

function SpotlightCard({ item, onSelect, size }) {
  const [failed, setFailed] = useState(false);
  const hasImage = item.image && !failed;

  return (
    <li className="shrink-0 snap-start">
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        aria-label={`Explore ${item.title}${item.city ? `, ${item.city}` : ''}`}
        className={`group relative block overflow-hidden rounded-2xl bg-ink-800 text-left shadow-lg ring-1 ring-black/5
                    transition duration-300 hover:-translate-y-1 hover:shadow-2xl focus-visible:-translate-y-1 ${size}`}
      >
        {hasImage ? (
          <img
            src={item.image}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 grid place-items-center bg-gradient-to-br from-sand-500 to-ink-800 text-white/60"
          >
            <Camera className="h-8 w-8" />
          </span>
        )}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/20 to-transparent" />

        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 text-white">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold leading-tight">{item.title}</span>
            {item.city && <span className="block truncate text-xs text-white/75">{item.city}</span>}
          </span>
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/95 text-ink-900 opacity-80 transition duration-300 group-hover:rotate-12 group-hover:opacity-100"
          >
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </span>
      </button>
    </li>
  );
}

export default function SpotlightSection({ spotlights, onSelect, isSample = false, layout = 'inline' }) {
  if (!spotlights?.length) return null;
  const rail = layout === 'rail';

  return (
    <section aria-label="Spotlight">
      <div className="mb-2 flex items-center gap-2">
        <h2
          className={`${SECTION_LABEL} ${
            rail ? 'rounded-full bg-white/90 px-2.5 py-1 text-ink-800 shadow dark:bg-ink-900/90 dark:text-sand-50' : ''
          }`}
        >
          Spotlight
        </h2>
        {isSample && (
          <span className="rounded-full bg-sand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sand-700 dark:bg-ink-700 dark:text-sand-200">
            Sample
          </span>
        )}
      </div>

      <ul
        className={`flex snap-x gap-3 overflow-x-auto pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          rail ? '' : '-mx-1 px-1'
        }`}
      >
        {spotlights.map((item) => (
          <SpotlightCard key={item.id} item={item} onSelect={onSelect} size={rail ? 'h-36 w-56' : 'h-40 w-44'} />
        ))}
      </ul>
    </section>
  );
}
