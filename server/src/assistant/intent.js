import { z } from 'zod';
import { INTENTS } from './state.js';

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
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

const RULES = {
  booking: /\b(book|booking|reserve|quote|checkout|check out|total (cost|price)|how much (for|will)|price for|pay)\b/i,
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

/** IST calendar date (YYYY-MM-DD) for a Date, regardless of server timezone. */
export function istDate(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Resolve "today", "tomorrow", "this weekend" or an ISO date into { from, to }. */
export function resolveDateRange(text, now = new Date()) {
  const iso = text.match(ISO_DATE_RE)?.[1];
  if (iso) return { from: iso, to: iso };

  const today = istDate(now);
  if (/\btoday\b/i.test(text)) return { from: today, to: today };
  if (/\btomorrow\b/i.test(text)) {
    const t = addDays(today, 1);
    return { from: t, to: t };
  }
  if (/\b(this|coming) weekend\b/i.test(text)) {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    const toSaturday = (6 - dow + 7) % 7;
    const saturday = dow === 0 ? addDays(today, -1) : addDays(today, toSaturday);
    return { from: dow === 0 ? today : saturday, to: dow === 0 ? today : addDays(saturday, 1) };
  }
  return null;
}

export function extractEntities(question, now = new Date()) {
  const entities = {};

  const seats =
    question.match(/\b(\d{1,2})\s*(?:people|persons?|pax|seats?|adults?|travell?ers?|tickets?|of us)\b/i) ??
    question.match(/\bfor\s+(\d{1,2})\b(?!\s*(?:days?|nights?|hours?))/i);
  if (seats) {
    const n = Number(seats[1]);
    if (n >= 1 && n <= 20) entities.seatCount = n;
  }

  const cap = question.match(/\b(?:under|below|within|less than|upto|up to|max(?:imum)?)\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*)/i);
  if (cap) entities.maxPrice = Number(cap[1].replace(/,/g, ''));

  if (/\b(cheapest|lowest price|most affordable|budget)\b/i.test(question)) entities.cheapest = true;

  const range = resolveDateRange(question, now);
  if (range) entities.dateRange = range;

  const id = question.match(UUID_RE)?.[0];
  if (id) entities.bookingId = id;

  return entities;
}

/**
 * Rule-based guess with a confidence. Tour-page context breaks ties toward `rag`,
 * because a question asked on a tour page is usually about that tour.
 */
export function heuristicClassify(question, { tourId = null } = {}) {
  if (RULES.smalltalk.test(question)) return { intent: 'smalltalk', confidence: 0.95 };

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
export async function classifyIntent({ question, context, history = [], llm, now = new Date() }) {
  const entities = extractEntities(question, now);
  const guess = heuristicClassify(question, context);

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
