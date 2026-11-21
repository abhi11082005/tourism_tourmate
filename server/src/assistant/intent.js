import { z } from 'zod';
import { INTENTS } from './state.js';
import { memoryEntities } from './memory.js';
import { istDate, addDays, resolveDateRange, dateProblem, MONTH_SRC } from './dates.js';

/*
 * Intent detection.
 *
 * Two stages, because the whole answer has a ~3s budget:
 *   1. Rules. Free and instant; resolves the obvious questions with high confidence.
 *   2. LLM (JSON mode, 1.5s cap). Only consulted when the rules are unsure AND a
 *      provider is configured. Any failure falls back to the rules' best guess.
 *
 * Entities (seat count, price cap, dates, booking id) are ALWAYS extracted by rules.
 * The model only picks the intent, so it can never smuggle arguments into a tool.
 */

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// "what happened?", "so?", "any update": about the last answer, not a new search.
const RECAP_RE =
  /^\s*(what\s*(has\s*|had\s*)?(happen(ed|s|ing)?|went wrong|is going on|now)|what\s+was\s+that|and\s+now|so+|any\s+update|status|why|huh|what\s*\?)[\s?!.]*$/i;

const RULES = {
  booking: /\b(book|booking|reserve|quote|checkout|check out|total (cost|price|amount)|final (price|cost|amount|total)|how much (for|will)|price for|pay)\b/i,
  live: /\b(seats?|availab\w*|sold out|full|offers?|discounts?|coupons?|deals?|sale|dates?|departures?|when (is|are|can))\b/i,
  discover: /\b(cheapest|cheap|budget|affordable|under|below|find|show me|recommend|suggest|packages?|tours? (in|to|for)|near ?me|nearby|around me|close to|places?)\b/i,
  rag: /\b(itinerary|includ\w*|exclu\w*|refund|cancel\w*|polic\w*|food|meals?|pick ?up|drop ?off|timings?|what to (carry|wear|bring)|worth|day \d|stops?|guide|difficulty|safe)\b/i,
  // A greeting or thanks and NOTHING else: "hi, any seats left?" must still reach a real intent.
  smalltalk: new RegExp(
    '^\\s*(' +
      '(hi+|hello|hey+|namaste|good (morning|evening|afternoon))(\\s+(there|team|friend|tour ?mate|everyone))?' +
      '|(thanks?|thank you|thx|ok(ay)?|cool|great|bye)(\\s+(a lot|so much|you|again|there))*' +
      ')[\\s!.?,]*$',
    'i'
  ),
};

export { istDate, addDays, resolveDateRange, dateProblem };

const COUPON_STOP = new Set(['CODE', 'CODES', 'ANY', 'THE', 'FOR', 'THIS', 'THAT', 'VALID', 'AVAILABLE', 'WORK', 'WORKS', 'APPLY', 'APPLIED', 'HAVE', 'HAVING', 'YOUR', 'WITH', 'DISCOUNT', 'OFFER', 'OFFERS', 'COUPON', 'COUPONS', 'PROMO', 'VOUCHER', 'ACTIVE', 'TODAY']);

/** "apply coupon SAVE10" / "promo code diwali20" -> SAVE10. A codeword needs a digit or capitals, so "any coupon available" is not a code. */
function couponCodeIn(text) {
  const m = text.match(/\b(?:coupon|promo(?:\s*code)?|voucher|code)\s*(?:code\s*)?(?:is|:|=)?\s*["'`]?([A-Za-z][A-Za-z0-9_-]{3,19})\b/i)
    ?? text.match(/\b(?:apply|use|try|redeem)\s+["'`]?([A-Za-z][A-Za-z0-9_-]{3,19})\b(?=.*\b(?:coupon|code|promo)\b)/i);
  const word = m?.[1];
  if (!word || COUPON_STOP.has(word.toUpperCase())) return null;
  return /\d/.test(word) || word === word.toUpperCase() ? word.toUpperCase() : null;
}

export function extractEntities(question, now = new Date()) {
  const entities = {};

  const seats =
    question.match(/\b(\d{1,2})\s*(?:people|persons?|pax|seats?|adults?|travell?ers?|tickets?|of us)\b/i) ??
    question.match(new RegExp(`\\bfor\\s+(\\d{1,2})\\b(?!\\s*(?:days?|nights?|hours?|(?:st|nd|rd|th)\\b|${MONTH_SRC}\\b))`, 'i'));
  if (seats) {
    const n = Number(seats[1]);
    if (n >= 1 && n <= 20) entities.seatCount = n;
  }

  const cap = question.match(/\b(?:under|below|within|less than|upto|up to|max(?:imum)?)\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*)/i);
  if (cap) entities.maxPrice = Number(cap[1].replace(/,/g, ''));

  if (/\b(cheapest|lowest price|most affordable|budget)\b/i.test(question)) entities.cheapest = true;

  // A date that does not exist, or has passed, is reported to the traveller, never silently
  // replaced by another day or sent on to the database.
  const problem = dateProblem(question, now);
  if (problem) entities.dateProblem = problem;
  else {
    const range = resolveDateRange(question, now);
    if (range) entities.dateRange = range;
  }

  const coupon = couponCodeIn(question);
  if (coupon) entities.couponCode = coupon;

  const id = question.match(UUID_RE)?.[0];
  if (id) entities.bookingId = id;

  return entities;
}

/**
 * Seat count and date carry over from the last few things the traveller said, so
 * "book Pink City on 21 November" followed by "for 2 people" is one booking, not two
 * unrelated questions. The newest message wins. Nothing else is sticky.
 */
export function stickyEntities(history = [], now = new Date()) {
  const carried = {};
  for (const m of history.filter((h) => h.role === 'user').slice(-4)) {
    const e = extractEntities(m.content, now);
    if (e.seatCount) carried.seatCount = e.seatCount;
    if (e.dateRange) carried.dateRange = e.dateRange;
  }
  return carried;
}

/**
 * Rule-based guess with a confidence. Tour-page context breaks ties toward `rag`,
 * because a question asked on a tour page is usually about that tour.
 */
export function heuristicClassify(question, { tourId = null } = {}) {
  if (RULES.smalltalk.test(question)) return { intent: 'smalltalk', confidence: 0.95 };
  if (RECAP_RE.test(question)) return { intent: 'followup', confidence: 0.95 };

  const hits = ['booking', 'live', 'discover', 'rag'].filter((k) => RULES[k].test(question));

  if (hits.length === 1) return { intent: hits[0], confidence: 0.9 };

  if (hits.length > 1) {
    // Priority: money/commitment questions first, then live inventory.
    const intent = ['booking', 'live', 'discover', 'rag'].find((k) => hits.includes(k));
    return { intent, confidence: 0.6 };
  }

  return { intent: tourId ? 'rag' : 'discover', confidence: 0.4 };
}

const llmAnswer = z.object({ intent: z.enum(INTENTS) });

const CLASSIFIER_PROMPT =
  'Classify the traveller message for a tour-booking assistant. Reply with JSON: {"intent": X} ' +
  'where X is one of: discover (find/compare/recommend tours or nearby places), ' +
  'rag (what a tour includes, itinerary, policies, food, refunds), ' +
  'live (seat availability, dates, offers, discounts), ' +
  'booking (price quote, booking, checkout status), smalltalk (greetings/thanks).';

/**
 * @param {{ question: string, context: { tourId: string|null }, history?: object[], llm?: { configured: boolean, completeJson: Function } }} args
 */
export async function classifyIntent({ question, context, history = [], memory = null, llm, now = new Date() }) {
  // Newest wins: this message > stored conversation state > what recent messages said.
  const entities = { ...stickyEntities(history, now), ...memoryEntities(memory), ...extractEntities(question, now) };
  const guess = heuristicClassify(question, context);
  // "what happened?" needs something to be about.
  if (guess.intent === 'followup' && !history.some((m) => m.role === 'assistant')) {
    return { intent: 'discover', entities, source: 'rules' };
  }

  // "yes", "ok what happens", "for 2 people": nothing in the words says what is meant,
  // so carry on with what the conversation was just about.
  const previous = [...history].reverse().find((m) => m.role === 'assistant' && m.intent)?.intent;
  if (guess.confidence < 0.5 && previous && previous !== 'smalltalk') {
    return { intent: previous, entities, source: 'context' };
  }

  if (guess.confidence >= 0.7 || !llm?.configured) {
    return { intent: guess.intent, entities, source: 'rules' };
  }

  try {
    const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content;
    const raw = await llm.completeJson([
      { role: 'system', content: CLASSIFIER_PROMPT },
      {
        role: 'user',
        content: `${lastUser ? `Previous message: ${lastUser}\n` : ''}Message: ${question}`,
      },
    ]);
    const parsed = llmAnswer.safeParse(JSON.parse(raw));
    if (parsed.success) return { intent: parsed.data.intent, entities, source: 'llm' };
  } catch {
    // Timeout, 429, bad JSON — the rules' guess is good enough to keep going.
  }
  return { intent: guess.intent, entities, source: 'rules' };
}
