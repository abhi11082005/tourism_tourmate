import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Compass, ExternalLink, Flag, Navigation } from 'lucide-react';
import BottomSheet from '../tour/BottomSheet.jsx';
import { api } from '../../lib/api.js';
import { googleDirectionsUrl, placeImage } from '../../lib/discovery.js';
import { CategoryDot, Distances, OpenNow, Rating, SourceBadge } from './PlaceBits.jsx';

/*
 * Full detail for one place, in the app's accessible modal sheet.
 *
 * Curated places lead with our own description and category, and list the tours that
 * visit them. External places show what Google returned for the details call —
 * fetched only when this opens, never for list rendering — and nothing else.
 */
export default function PlaceDetail({
  place,
  travel,
  mode,
  origin,
  onClose,
  onDirections,
  onSetDestination,
  onExploreNearby,
}) {
  const open = Boolean(place);
  // Keep showing the last place while the sheet slides out.
  const [shown, setShown] = useState(place);
  useEffect(() => {
    if (place) setShown(place);
  }, [place]);
  const p = shown;

  const google = p?.source === 'google';
  const details = useQuery({
    queryKey: ['explore', 'place', p?.placeId],
    queryFn: ({ signal }) => api.placeDetails(p.placeId, signal),
    enabled: open && google,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });
  const curated = useQuery({
    queryKey: ['explore', 'attraction', p?.id],
    queryFn: ({ signal }) => api.getAttraction(p.id, signal),
    enabled: open && p?.source === 'tourmate',
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!p) return null;

  const d = details.data?.place;
  const c = curated.data?.attraction;
  const description = c?.description || p.description || d?.summary || null;
  const photos = google ? d?.photos ?? (p.photo ? [p.photo] : []) : [];
  const hero = google ? null : placeImage(p, 900);

  const directionsUrl = googleDirectionsUrl({
    origin: origin.approximate ? null : origin,
    destination: p,
    mode,
  });

  return (
    <BottomSheet open={open} onClose={onClose} title={p.name}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        {hero && <img src={hero} alt="" className="h-48 w-full rounded-2xl object-cover" referrerPolicy="no-referrer" />}

        {photos.length > 0 && (
          <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {photos.map((ph) => (
              <figure key={ph.name} className="shrink-0 snap-start">
                <img
                  src={api.placePhotoUrl(ph.name, 640)}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-44 w-64 rounded-2xl object-cover"
                />
                {ph.attributions?.[0]?.name && (
                  <figcaption className="faint mt-1 max-w-64 truncate text-[10px]">Photo: {ph.attributions[0].name}</figcaption>
                )}
              </figure>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <SourceBadge source={p.source} />
          <CategoryDot place={p} />
          <Rating place={d ? { ...p, rating: d.rating, ratingCount: d.ratingCount } : p} />
          <OpenNow place={d ? { ...p, openNow: d.openNow } : p} />
        </div>

        {description && <p className="muted text-sm leading-relaxed">{description}</p>}
        {google && details.isPending && <div className="h-10 animate-pulse rounded-xl bg-sand-100 dark:bg-ink-800" aria-hidden />}
        {google && details.isError && (
          <p className="notice-error">More details from Google aren&apos;t available right now.</p>
        )}

        {(d?.address ?? p.address) && (
          <p className="text-sm">
            <span className="faint block text-[11px] font-bold uppercase tracking-[0.14em]">Address</span>
            {d?.address ?? p.address}
          </p>
        )}
        {p.city && !p.address && <p className="text-sm">{p.city}</p>}
        {p.visitMinutes > 0 && <p className="faint text-xs">Visitors usually spend about {p.visitMinutes} min here.</p>}

        {d?.weekdayHours?.length > 0 && (
          <div>
            <span className="faint block text-[11px] font-bold uppercase tracking-[0.14em]">Opening hours</span>
            <ul className="mt-1 space-y-0.5 text-sm">
              {d.weekdayHours.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <span className="faint block text-[11px] font-bold uppercase tracking-[0.14em]">Getting there</span>
          <div className="mt-1">
            <Distances place={p} travel={travel} mode={mode} />
            {!travel && <p className="faint text-xs">Press “Get directions” for the real road distance and time.</p>}
          </div>
        </div>

        {c?.tours?.length > 0 && (
          <div>
            <span className="faint block text-[11px] font-bold uppercase tracking-[0.14em]">On these tours</span>
            <ul className="mt-1 flex flex-wrap gap-2">
              {c.tours.map((t) => (
                <li key={t.id}>
                  <Link to={`/tours/${t.slug}`} className="chip min-h-9 hover:border-glow">
                    {t.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn-primary" onClick={() => onDirections(p)}>
            <Navigation className="h-4 w-4" aria-hidden />
            Get directions
          </button>
          <button type="button" className="btn-ghost" onClick={() => onExploreNearby(p)}>
            <Compass className="h-4 w-4" aria-hidden />
            Explore nearby
          </button>
          <button type="button" className="btn-ghost" onClick={() => onSetDestination(p)}>
            <Flag className="h-4 w-4" aria-hidden />
            Use in tour route
          </button>
          <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">
            <ExternalLink className="h-4 w-4" aria-hidden />
            Open in Google Maps
          </a>
        </div>
        {google && d?.websiteUri && (
          <a href={d.websiteUri} target="_blank" rel="noopener noreferrer nofollow" className="block text-center text-sm font-semibold underline">
            Visit website
          </a>
        )}
      </div>
    </BottomSheet>
  );
}
