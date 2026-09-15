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
      className="relative mb-6 overflow-hidden rounded-2xl text-white shadow-sm"
      aria-label="Festival offer"
    >
      {/* Backdrop: the campaign's own banner if it has one, otherwise a festive
          gradient that reads the same in light and dark. */}
      {primary.bannerUrl ? (
        <>
          <img src={primary.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-900/80 via-ink-900/60 to-ink-900/25" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-r from-glow via-orange-500 to-orange-600" />
      )}

      {/* Decorative pulse — purely visual, and it stops under prefers-reduced-motion. */}
      <span aria-hidden="true" className="absolute -right-6 -top-8 h-32 w-32 rounded-full bg-white/25 blur-2xl animate-pulseGlow" />

      <div className="relative flex items-center justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/85">Festival offer</p>
          <p className="mt-0.5 truncate text-lg font-black leading-tight sm:text-2xl">
            {primary.name} · {primary.discountPercent}% OFF
          </p>
          <p className="mt-0.5 text-sm text-white/90">
            Auto-applied at checkout — no code needed.{' '}
            <Link to="/tours" className="font-semibold underline underline-offset-2">
              Browse tours
            </Link>
          </p>

          {others.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {others.map((c) => (
                <li key={c.id ?? c.name} className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold backdrop-blur">
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
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20 text-lg leading-none backdrop-blur transition hover:bg-white/30"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
