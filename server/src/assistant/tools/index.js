import { discoveryTools } from './discovery.js';
import { ragTools } from './rag.js';
import { liveTools } from './live.js';
import { bookingTools } from './booking.js';

/*
 * Tool registry. `deps` is injected so the graph can be tested with fakes and no
 * database; `defaultDeps()` (deps.js) wires the real TourMate services.
 */
export function buildTools(deps) {
  const all = [
    ...discoveryTools(deps),
    ...ragTools(deps),
    ...liveTools(deps),
    ...bookingTools(deps),
  ];
  return new Map(all.map((t) => [t.name, t]));
}

/**
 * Decide which tools run for this turn. Pure and deterministic: the model picks the
 * intent, this function picks the tools and their arguments from rule-extracted
 * entities, so user text can never choose a tool or inject its parameters.
 *
 * @returns {{ name: string, args: object }[]}
 */
export function selectTools({ intent, entities, question, context }) {
  const e = entities ?? {};

  switch (intent) {
    case 'discover': {
      if (/\b(near ?me|nearby|around me|close to)\b/i.test(question) && !/\btours?\b/i.test(question)) {
        return [{ name: 'nearby_attractions', args: {} }];
      }
      if (e.cheapest || e.maxPrice) {
        return [{ name: 'cheapest_tours', args: { maxPrice: e.maxPrice } }];
      }
      return [{ name: 'search_tours', args: { term: searchTerm(question), maxPrice: e.maxPrice } }];
    }

    case 'rag': {
      const picks = [{ name: 'tour_knowledge', args: { question } }];
      if (/\b(refund|cancel\w*|polic\w*|includ\w*|exclu\w*)\b/i.test(question)) {
        picks.push({ name: 'tour_policies', args: {} });
      }
      return picks;
    }

    case 'live': {
      const picks = [];
      if (/\b(offers?|discounts?|coupons?|deals?|sale)\b/i.test(question)) {
        picks.push({ name: 'active_offers', args: {} });
      }
      if (context.tourId && (picks.length === 0 || /\b(seats?|availab\w*|dates?)\b/i.test(question))) {
        picks.push({
          name: 'seat_availability',
          args: { dateRange: e.dateRange, seatCount: e.seatCount },
        });
      }
      return picks.length ? picks : [{ name: 'seat_availability', args: {} }];
    }

    case 'booking': {
      if (e.bookingId) return [{ name: 'checkout_state', args: { bookingId: e.bookingId } }];
      if (/\b(my booking|checkout|payment status)\b/i.test(question)) {
        return [{ name: 'checkout_state', args: {} }];
      }
      return [{ name: 'price_quote', args: { seatCount: e.seatCount, dateRange: e.dateRange } }];
    }

    default:
      return [];
  }
}

/** Strip filler so "find me a heritage tour in Varanasi" searches "heritage Varanasi". */
function searchTerm(question) {
  const cleaned = question
    .replace(/\b(find|show|me|a|an|the|some|any|best|good|tours?|packages?|in|to|for|please|recommend|suggest|i want|looking)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}
