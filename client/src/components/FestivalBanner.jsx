import { useEffect, useMemo, useState } from 'react';
import { useActiveCampaign } from '../hooks/useActiveCampaign.js';
import { DEALS_ANCHOR } from '../lib/campaign.js';
import SaleHero, { SaleHeroSkeleton } from './sale/SaleHero.jsx';

/*
 * The homepage festival hero — the connected wrapper around <SaleHero>. It reads the
 * same live campaigns that put strike-through prices on the tour cards, so the hero
 * and the cards can never disagree about what's on offer.
 *
 * States:
 *   loading  → a skeleton, but only if the request is still pending after 200 ms, so a
 *              normal (no-sale) day never flashes a 500px placeholder that then collapses
 *   error    → nothing (the offer engine is a nice-to-have; browsing must not depend on it)
 *   empty    → nothing
 *   expired  → nothing (useActiveCampaign drops a campaign the moment its window closes)
 *
 * `tours` is the already-loaded tour list from the page. It supplies a real photo when
 * the campaign has no banner of its own, and the "Biggest savings" shortlist — both
 * from data the page fetched anyway, nothing extra.
 */

function useAfterDelay(active, ms) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return undefined;
    }
    const id = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return elapsed;
}

function scrollToDeals() {
  const el = document.getElementById(DEALS_ANCHOR);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

export default function FestivalBanner({ tours = [] }) {
  const { primary, discountFor, isPending } = useActiveCampaign();
  const showSkeleton = useAfterDelay(isPending, 200);

  const featured = useMemo(
    () =>
      tours
        .map((tour) => ({ tour, discount: discountFor(tour.base_price) }))
        .filter((x) => x.discount && x.tour.slug)
        .sort((a, b) => b.discount.saved - a.discount.saved)
        .slice(0, 3),
    [tours, discountFor]
  );

  if (!primary) return showSkeleton ? <SaleHeroSkeleton /> : null;

  return (
    <SaleHero
      campaign={primary}
      featured={featured}
      fallbackImage={tours.find((t) => t.cover_url)?.cover_url ?? null}
      onExploreDeals={scrollToDeals}
    />
  );
}
