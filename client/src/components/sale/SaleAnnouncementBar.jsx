import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Countdown from './Countdown.jsx';
import { useActiveCampaign } from '../../hooks/useActiveCampaign.js';
import { COUNTDOWN_WINDOW_MS, DEALS_ANCHOR } from '../../lib/campaign.js';

/*
 * The slim sale strip above the header on every page except the ones where it would
 * repeat or intrude: the homepage (the hero already says it), checkout (don't
 * distract a paying customer) and admin.
 *
 * Dismissal is remembered for the browser session only, and per campaign — closing
 * "Diwali" doesn't hide a different campaign launched later. Storage can be blocked
 * (private mode), so every access is wrapped; without it the bar just returns on
 * the next page load.
 */

const HIDDEN_ON = [/^\/$/, /^\/admin/, /^\/checkout/];

const readDismissed = (key) => {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

/** The bar itself. Also used by the admin live preview, hence no data fetching here. */
export function AnnouncementBarView({ campaign, onDismiss, onExploreDeals }) {
  const percent = Number(campaign.discountPercent);
  const endMs = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;
  const msLeft = endMs != null && !Number.isNaN(endMs) ? endMs - Date.now() : null;
  const showCountdown = msLeft != null && msLeft > 0 && msLeft <= COUNTDOWN_WINDOW_MS;

  return (
    <div
      role="region"
      aria-label="Sale announcement"
      className="border-b border-white/10 bg-ink-900 text-sand-50 dark:bg-ink-950"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-xs sm:gap-3 sm:text-sm">
        <span className="shrink-0 rounded-full bg-glow px-2.5 py-0.5 text-[11px] font-black tracking-wide text-ink-900">
          {percent}% OFF
        </span>
        <p className="min-w-0 flex-1 truncate">
          <strong className="font-semibold">{campaign.name}</strong>
          <span className="hidden text-sand-300 sm:inline"> · On every tour, applied automatically</span>
          {showCountdown && (
            <span className="ml-2 text-sand-300">
              · Ends in <Countdown endsAt={campaign.endsAt} variant="inline" />
            </span>
          )}
        </p>
        {onExploreDeals ? (
          <button
            type="button"
            onClick={onExploreDeals}
            className="shrink-0 rounded-full bg-white/10 px-3 py-1 font-semibold transition hover:bg-white/20"
          >
            Explore deals
          </button>
        ) : (
          <Link
            to={`/#${DEALS_ANCHOR}`}
            className="shrink-0 rounded-full bg-white/10 px-3 py-1 font-semibold transition hover:bg-white/20"
          >
            Explore deals
          </Link>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss sale announcement"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-base leading-none text-sand-300 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export default function SaleAnnouncementBar() {
  const { primary } = useActiveCampaign();
  const { pathname } = useLocation();
  const [closedKey, setClosedKey] = useState(null);

  if (!primary || HIDDEN_ON.some((re) => re.test(pathname))) return null;

  const key = `tourmate:sale-bar:${primary.id ?? primary.name}:${primary.endsAt ?? ''}`;
  if (closedKey === key || readDismissed(key)) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage blocked: the in-memory state below still hides it for this page view */
    }
    setClosedKey(key);
  };

  return <AnnouncementBarView campaign={primary} onDismiss={dismiss} />;
}
