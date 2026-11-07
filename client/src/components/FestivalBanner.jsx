import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActiveCampaign } from '../hooks/useActiveCampaign.js';

/*
 * The homepage festival strip — the loud, Blinkit-style promo bar that sits above
 * everything in guest mode. It reads the same live campaigns that put strike-through
 * prices on the tour cards, so the banner and the cards can never disagree about
 * what's on offer.
 *
 * It renders nothing when there's no live campaign (or if the campaigns endpoint is
 * down) — a blank promo bar is worse than none. The deepest active discount headlines
 * the bar; any others ride along as small chips so a second festival isn't hidden.
 *
 * Dismiss is per-session (component state, not storage): closing it clears the bar
 * for this visit, and it returns on the next load — appropriate for a promo, not a
 * consent notice.
 */

export default function FestivalBanner() {
  const { primary, campaigns } = useActiveCampaign();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !primary) return null;

  const others = campaigns.filter((c) => c !== primary);

  return (
    <aside
      className="relative mb-8 overflow-hidden rounded-2xl text-white shadow-md transition-all md:mb-12 lg:rounded-3xl"
      aria-label="Festival offer"
    >
      {/* Backdrop: the campaign's own banner if it has one, otherwise a festive
          gradient that reads the same in light and dark. */}
      {primary.bannerUrl ? (
        <>
          <img src={primary.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-900/90 via-ink-900/70 to-ink-900/40 md:via-ink-900/60 md:to-ink-900/20" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-r from-glow via-orange-500 to-orange-600" />
      )}

      {/* Decorative pulse — purely visual, and it stops under prefers-reduced-motion. */}
      <span aria-hidden="true" className="absolute -right-6 -top-8 h-48 w-48 rounded-full bg-white/25 blur-3xl animate-pulseGlow md:h-72 md:w-72" />

      {/* Content wrapper with highly responsive padding and layout gaps */}
      <div className="relative flex items-start justify-between gap-4 p-6 sm:items-center sm:p-8 md:gap-8 md:p-12 lg:p-16">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-white/85 sm:text-sm md:text-base">
            Festival offer
          </p>
          <p className="mt-1 truncate text-2xl font-black leading-tight sm:text-3xl md:mt-2 md:text-5xl lg:text-6xl"> 
            {primary.name} <span className="inline-block md:ml-2">· {primary.discountPercent}% OFF</span>
          </p>
          <p className="mt-2 text-sm text-white/90 sm:text-base md:mt-4 md:text-xl">
            Auto-applied at checkout — no code needed.{' '}
            <Link to="/tours" className="font-semibold underline underline-offset-4 hover:text-white transition-colors">
              Browse tours
            </Link>
          </p>

          {others.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2 md:mt-6 md:gap-3">
              {others.map((c) => (
                <li key={c.id ?? c.name} className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur sm:text-sm md:px-4 md:py-1.5 md:text-base border border-white/10 shadow-sm">
                  {c.name} · {c.discountPercent}%
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss offer"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/20 text-lg leading-none backdrop-blur transition hover:bg-white/30 md:h-12 md:w-12 md:text-xl"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}