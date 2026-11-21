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
      if (/\b(near ?me|nearby|around me|close to|near my)\b/i.test(question)) {
        // "what is near me" -> places;  "which tour is near my location" -> tours.
        return [{ name: /\btours?\b|packages?/i.test(question) ? 'tours_near_me' : 'nearby_attractions', args: {} }];
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
      if (e.couponCode) picks.push({ name: 'check_coupon', args: { couponCode: e.couponCode, seatCount: e.seatCount } });
      if (context.tourId && (picks.length === 0 || /\b(seats?|availab\w*|dates?)\b/i.test(question))) {
        picks.push({
          name: 'seat_availability',
          args: { dateRange: e.dateRange, seatCount: e.seatCount, dateProblem: e.dateProblem },
        });
      }
      // Seats were asked about but no tour is known: show tours to choose from.
      return picks.length ? picks : [{ name: 'search_tours', args: { forBooking: true } }];
    }

    case 'booking': {
      if (e.bookingId) return [{ name: 'checkout_state', args: { bookingId: e.bookingId } }];
      if (/\b(my booking|checkout|payment status)\b/i.test(question)) {
        return [{ name: 'checkout_state', args: {} }];
      }
      // Wants to book but has not said which tour: put the tours in front of them.
      if (!context.tourId) return [{ name: 'search_tours', args: { forBooking: true } }];
      return [{ name: 'price_quote', args: { seatCount: e.seatCount, dateRange: e.dateRange, dateProblem: e.dateProblem } }];
    }

    // "what happened?": explained from the stored state and the last answer; no new lookups.
    default:
      return [];
  }
}

const FILLER =
  'find|show|me|a|an|the|some|any|best|good|tours?|packages?|trips?|in|to|for|please|recommend|suggest|' +
  'i|want|wants|would|like|looking|let|lets|let\'s|book|booking|reserve|buy|get|is|there|are|which|what|' +
  'where|can|could|you|my|on|at|of|and|or|this|that|with|available|availability|seats?|date|dates|' +
  'price|cost|final|pay|total|how|much|many|yes|no|ok|okay|near|nearby|location|around|here|' +
  'today|tomorrow|weekend|people|persons?|pax|adults?|travell?ers?|tickets?|link|http|https|localhost|www|com';
const MONTHS_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/** Strip filler, dates and counts so "i want to book on 21 november" leaves nothing to search for. */
function searchTerm(question) {
  const cleaned = question
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?(?:${MONTHS_RE})\\b(?:\\s*\\d{4})?`, 'gi'), ' ')
    .replace(new RegExp(`\\b(?:${MONTHS_RE})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(?:${FILLER})\\b`, 'gi'), ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}
