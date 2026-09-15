import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/*
 * Live festival campaigns for guest mode.
 *
 * One public query feeds two surfaces: the homepage banner and the strike-through
 * prices on every tour card. It is deliberately allowed to fail quietly — if the
 * campaigns endpoint is missing or down, the banner simply doesn't render and cards
 * show their normal price. `retry: false` keeps a missing route from spamming the
 * network tab; the offer engine is a nice-to-have, not load-bearing for browsing.
 *
 * The percentage here drives a *display-only* "from" price. Money stays
 * server-authoritative: the real total is re-derived by the quote and checkout
 * calls, so this arithmetic never decides what a traveller is charged.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function useActiveCampaign() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['campaigns', 'active'],
    queryFn: ({ signal }) => api.activeCampaigns(signal),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Accept either { campaigns: [...] } or a bare array, and keep only the ones the
  // server marked live with a usable discount.
  const campaigns = useMemo(() => {
    const raw = Array.isArray(data) ? data : (data?.campaigns ?? []);
    return raw
      .map((c) => ({ ...c, discountPercent: num(c.discountPercent) }))
      .filter((c) => c.isActive !== false && c.discountPercent > 0);
  }, [data]);

  // The banner shows one headline offer: the deepest active discount wins.
  const primary = useMemo(
    () =>
      campaigns.reduce(
        (best, c) => (!best || c.discountPercent > best.discountPercent ? c : best),
        null
      ),
    [campaigns]
  );

  /*
   * Card helper. Given a base price string from the API, returns the pieces a
   * TourCard needs to strike through the old price, or null when there is no live
   * offer — so the card can render `discount && <s>…</s>` without any math itself.
   */
  const discountFor = useCallback(
    (basePrice) => {
      if (!primary) return null;
      const original = num(basePrice);
      if (original <= 0) return null;
      const discounted = Math.round(original * (1 - primary.discountPercent / 100));
      if (discounted >= original) return null;
      return {
        percent: primary.discountPercent,
        original,
        discounted,
        label: primary.name ?? 'Festival offer',
        campaign: primary,
      };
    },
    [primary]
  );

  return { campaigns, primary, discountFor, isPending, isError };
}
