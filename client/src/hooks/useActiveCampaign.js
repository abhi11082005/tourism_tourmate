import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { MAX_TIMEOUT_MS, campaignState, computeDeal, nextBoundary } from '../lib/campaign.js';

/*
 * Live festival campaigns for guest mode.
 *
 * One public query feeds every sale surface: the homepage hero, the announcement bar
 * and the strike-through prices on cards, the tour page and the compare table. It is
 * deliberately allowed to fail quietly — if the campaigns endpoint is missing or
 * down, nothing sale-related renders and prices show normally. `retry: false` keeps a
 * missing route from spamming the network tab.
 *
 * Two things this hook does that the raw response doesn't:
 *
 *  1. It re-checks each campaign's start/end window against the clock. The response
 *     is cached for minutes, so without this a sale that ended while the tab was open
 *     would keep advertising a discount the server will now refuse at checkout.
 *     A single timer wakes the hook at the next start/end boundary, re-filters, and
 *     asks the server for a fresh list.
 *
 *  2. All discount arithmetic goes through computeDeal (lib/campaign.js), which
 *     mirrors the server's own rounding. The figures here are still display-only:
 *     the quote and checkout calls re-derive the real total on the server.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function useActiveCampaign() {
  const qc = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: ['campaigns', 'active'],
    queryFn: ({ signal }) => api.activeCampaigns(signal),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [now, setNow] = useState(() => Date.now());

  // Accept either { campaigns: [...] } or a bare array; keep usable discounts only.
  const parsed = useMemo(() => {
    const raw = Array.isArray(data) ? data : (data?.campaigns ?? []);
    return raw
      .map((c) => ({ ...c, discountPercent: num(c.discountPercent) }))
      .filter((c) => c.discountPercent > 0);
  }, [data]);

  // Only campaigns whose window is open right now (and that aren't paused).
  const campaigns = useMemo(
    () => parsed.filter((c) => campaignState(c, now) === 'live'),
    [parsed, now]
  );

  // Wake at the next start/end boundary: re-filter locally, then refresh from the server.
  useEffect(() => {
    const next = nextBoundary(parsed, now);
    if (next == null) return undefined;
    const delay = Math.min(Math.max(next - Date.now(), 0) + 250, MAX_TIMEOUT_MS);
    const id = setTimeout(() => {
      setNow(Date.now());
      qc.invalidateQueries({ queryKey: ['campaigns', 'active'] });
    }, delay);
    return () => clearTimeout(id);
  }, [parsed, now, qc]);

  // One headline offer, and the one every card uses: the deepest live discount wins.
  const primary = useMemo(
    () =>
      campaigns.reduce(
        (best, c) => (!best || c.discountPercent > best.discountPercent ? c : best),
        null
      ),
    [campaigns]
  );

  /*
   * Card helper. Given a base price from the API, returns everything a surface needs
   * to show the offer — or null when there is no live offer, so callers can render
   * `discount && …` without doing any math themselves.
   */
  const discountFor = useCallback(
    (basePrice) => {
      if (!primary) return null;
      const deal = computeDeal(basePrice, primary.discountPercent);
      if (!deal) return null;
      return {
        percent: primary.discountPercent,
        original: deal.original,
        discounted: deal.discounted,
        saved: deal.saved,
        label: primary.name ?? 'Festival offer',
        endsAt: primary.endsAt ?? null,
        campaign: primary,
      };
    },
    [primary]
  );

  return { campaigns, primary, discountFor, isPending, isError };
}
