import { CoverFallback } from './TourBits.jsx';

/* "Places you'll explore": real attractions from the tour detail response. */
export default function TourHighlights({ attractions }) {
  if (!attractions?.length) return null;

  return (
    <section aria-labelledby="qv-places">
      <h3 id="qv-places" className="text-sm font-semibold">
        Places you’ll explore
      </h3>
      <ul className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {attractions.map((a) => (
          <li key={a.id} className="w-28 shrink-0">
            <div className="relative aspect-square overflow-hidden rounded-xl bg-sand-100 dark:bg-ink-800">
              {a.image_url ? (
                <img
                  src={a.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <CoverFallback title="" />
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug">{a.name}</p>
            {a.category && (
              <p className="text-[11px] capitalize faint">
                {String(a.category).toLowerCase().replace(/_/g, ' ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}