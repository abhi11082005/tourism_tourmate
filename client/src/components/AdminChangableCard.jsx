import { memo } from 'react';
import { inr } from '../lib/format.js';

/*
 * Admin Package Card.
 * Displays a summary of a tour in the admin dashboard with quick actions 
 * to Edit (which includes extending dates/slots) or Delete.
 */
function AdminChangableCard({ tour, onEdit, onDelete, isDeleting }) {
  const isPublished = tour.is_published ?? tour.isPublished;
  
  
  return (
    <article className="card group flex flex-col overflow-hidden dark:bg-ink-900 dark:border-ink-700">
      <div className="relative aspect-[3/2] overflow-hidden bg-sand-100 dark:bg-ink-800">
        {tour.cover_url || tour.gallery?.[0]?.url ? (
          <img
            src={tour.cover_url || tour.gallery?.[0]?.url}
            alt={tour.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-sand-500 dark:text-sand-400">
            No photo yet
          </div>
        )}

        {/* Admin Status Badge */}
        <span 
          className={`absolute left-2 top-2 chip bg-white/90 backdrop-blur dark:bg-ink-900/90 ${
            isPublished 
              ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900/50 dark:text-emerald-400' 
              : 'border-amber-200 text-amber-700 dark:border-amber-900/50 dark:text-amber-400'
          }`}
        >
          {isPublished ? 'Live' : 'Draft'}
        </span>

        <span className="absolute bottom-2 left-2 chip border-transparent bg-white/90 backdrop-blur dark:border-ink-700 dark:bg-ink-900/90 dark:text-sand-50">
          {tour.duration_days}D / {tour.duration_nights}N
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4 text-ink-900 dark:text-sand-50">
        <h3 className="text-base font-semibold leading-snug">
          {tour.title}
        </h3>

        <p className="mt-1 line-clamp-2 text-sm text-ink-700 dark:text-sand-300">
          {tour.teaser || tour.overview}
        </p>

        <div className="mt-3 flex items-center gap-2 text-xs text-sand-500 dark:text-sand-400">
          <span className="chip capitalize dark:border-ink-700 dark:bg-ink-800">
            {String(tour.tour_type ?? 'HERITAGE').toLowerCase().replace(/_/g, ' ')}
          </span>
          <span>Base: {inr(tour.base_price)}</span>
          <span>•</span>
          <span>{tour.total_seats} capacity</span>
        </div>

        {/* Admin Action Buttons */}
        <footer className="mt-auto flex items-center justify-between gap-2 border-t border-sand-100 pt-3 dark:border-ink-700/50 ">
          <button
            type="button"
            onClick={() => onDelete(tour.id, tour.title)}
            disabled={isDeleting}
            className="text-xs font-semibold text-red-600 transition-colors hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
          >
            {isDeleting ? 'Deleting...' : 'Delete tour'}
          </button>
          
          <button
            type="button"
            onClick={() => onEdit(tour.slug)}
            className="btn-primary py-1.5 px-3 text-xs"
          >
            Edit & Manage Dates
          </button>
        </footer>
      </div>
    </article>
  );
}

export default memo(AdminChangableCard);