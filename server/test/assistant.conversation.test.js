import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantGraph } from '../src/assistant/graph.js';
import { buildTools } from '../src/assistant/tools/index.js';
import { createTourResolver } from '../src/assistant/tourResolver.js';
import { fallbackAnswer } from '../src/assistant/fallback.js';
import { istDate, addDays } from '../src/assistant/intent.js';

/*
 * Replays the conversations that failed on a real machine (the assistant_messages log):
 *   - "i want to book <link to the tour>"            -> asked "which tour?" forever
 *   - "Pink city Heritage Trail" / "book on 21 november" -> forgot the tour, ignored the date
 *   - "yes", "what happen"                            -> treated as brand-new searches
 *   - answers that were blank or cut off mid-sentence -> nothing shown
 *   - "I'll check with the operations team"           -> a promise nothing could keep
 * Real tool code, real tour resolver, fake services and a fake model: no database, no network.
 */

const PINK = '22222222-2222-4222-8222-000000000001';
const KASHI = '11111111-1111-4111-8111-111111111111';
const CATALOG = [
  { id: PINK, slug: 'pink-city-heritage-trail', title: 'Pink City Heritage Trail' },
  { id: KASHI, slug: 'kashi-heritage-walk', title: 'Kashi Heritage Walk' },
  { id: '33333333-3333-4333-8333-000000000003', slug: 'pink-city-food-walk', title: 'Pink City Food Walk' },
];

// Relative to the real clock: tools drop past dates, so fixed dates would rot.
const TODAY = istDate(new Date());
const DEPART = addDays(TODAY, 10);
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => `${Number(iso.slice(8))} ${MONTH[Number(iso.slice(5, 7)) - 1].toLowerCase()} ${iso.slice(0, 4)}`;

function makeDeps({ tours = null } = {}) {
  const calls = [];
  const rec = (name, ret) => async (...args) => {
    calls.push({ name, args });
    return typeof ret === 'function' ? ret(...args) : ret;
  };
  const row = (c) => ({ id: c.id, title: c.title, slug: c.slug, tour_type: 'HERITAGE', base_price: '8499.00', duration_days: 3, duration_nights: 2, teaser: 'x' });
  return {
    calls,
    deps: {
      tours: {
        listTours: rec('listTours', tours ?? (({ q }) => {
          const hits = CATALOG.filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().split(' ').every((w) => c.title.toLowerCase().includes(w)));
          return { total: hits.length, items: hits.map(row) };
        })),
      },
      attractions: { findNearby: rec('findNearby', [{ id: 'a1', name: 'Chandra Shekhar Udyan', category: 'PARK', city: 'Varanasi', distance_m: 3600 }]) },
      rag: { embed: rec('embed', [0.1]), retrieve: rec('retrieve', []) },
      db: {
        query: rec('query', { rows: [] }),
        queryOne: rec('queryOne', { slug: 'pink-city-heritage-trail', title: 'Pink City Heritage Trail', options: {} }),
      },
      booking: {
        getCalendar: rec('getCalendar', [{ slotId: 's-depart', date: DEPART, isOpen: true, availableSeats: 8, priceModifier: '0.00' }]),
        quote: rec('quote', ({ seatCount }) => ({ totalAmount: (8499 * seatCount).toFixed(2), breakdown: { lines: [] } })),
        getCheckoutState: rec('getCheckoutState', {}),
      },
      offers: { activeCampaigns: rec('activeCampaigns', []) },
    },
  };
}

/** `stream` decides what the fake model does; default is a normal short answer. */
async function turn({ question, context = {}, history = [], stream, tours }) {
  const { deps, calls } = makeDeps({ tours });
  const seen = { prompt: '', system: '' };
  const llm = {
    configured: false,
    completeJson: async () => { throw new Error('rules only'); },
    stream: stream ?? (async (messages, { onToken }) => {
      seen.system = messages[0].content;
      seen.prompt = messages.at(-1).content;
      onToken('Sure.');
      return 'Sure.';
    }),
  };
  const warnings = [];
  const graph = buildAssistantGraph({
    tools: buildTools(deps),
    llm,
    resolveTour: createTourResolver({ db: { query: async () => ({ rows: CATALOG }) } }),
    log: { warn: (...a) => warnings.push(a) },
  });
  const events = [];
  const state = await graph.invoke(
    { question, history, context: { tourId: null, user: null, location: null, focusTourId: null, ...context } },
    { configurable: { emit: (event, data) => events.push({ event, data }) } }
  );
  const blocks = events.filter((e) => e.event === 'ui').flatMap((e) => e.data);
  return {
    state, events, calls, blocks, warnings, seen,
    called: (n) => calls.some((c) => c.name === n),
    quote: blocks.find((b) => b.type === 'quote'),
    tokens: events.filter((e) => e.event === 'token').map((e) => e.data.token).join(''),
  };
}

/* ------------------------------------------------------------- which tour? */

test('a pasted tour link binds the chat to that tour and prices it', async () => {
  const r = await turn({ question: 'I want to book http://localhost:5173/tours/pink-city-heritage-trail tour package' });
  assert.equal(r.state.intent, 'booking');
  assert.equal(r.state.context.tourId, PINK);
  assert.equal(r.quote.tourId, PINK);
  assert.equal(r.quote.tourTitle, 'Pink City Heritage Trail');
  assert.equal(r.quote.seatCount, 1, 'no count given -> one seat, adjustable on the card');
  assert.ok(r.events.some((e) => e.event === 'focus' && e.data.tourId === PINK));
  assert.match(r.seen.prompt, /TOUR IN FOCUS: Pink City Heritage Trail/);
  assert.match(r.seen.prompt, /CARDS SHOWN UNDER YOUR REPLY: quote/);
});

test('naming the tour with a long-form date books that departure (your exact sentence)', async () => {
  const r = await turn({ question: `i want to book pink city heritage trail  on ${longDate(DEPART)}` });
  assert.equal(r.state.context.tourId, PINK);
  assert.equal(r.calls.find((c) => c.name === 'quote').args[0].slotId, 's-depart');
  assert.equal(r.quote.date, DEPART);
  assert.equal(r.quote.slotId, 's-depart');
});

test('a partial name that fits two tours is not guessed', async () => {
  const r = await turn({ question: 'tell me about pink city' });
  assert.equal(r.state.context.tourId, null);
});

/* ------------------------------------------------------------- memory across turns */

test('"Pink city Heritage Trail" alone shows the tour, then "book on <date>" remembers it', async () => {
  const first = await turn({ question: 'Pink city Heritage Trail' });
  assert.equal(first.state.context.tourId, PINK);
  assert.equal(first.blocks[0].type, 'tour_cards');

  // The route stored PINK on the conversation and replays intent in the history.
  const second = await turn({
    question: `i want to book on ${longDate(DEPART)}`,
    context: { focusTourId: PINK },
    history: [
      { role: 'user', content: 'Pink city Heritage Trail' },
      { role: 'assistant', content: 'The Pink City Heritage Trail is ₹8,499 per seat.', intent: 'discover' },
    ],
  });
  assert.equal(second.state.intent, 'booking');
  assert.equal(second.state.context.tourId, PINK, 'tour remembered from the conversation');
  assert.equal(second.quote.date, DEPART, 'date understood');
  assert.ok(!second.called('listTours'), 'no more "tours on that date" searches');
});

test('seat count and date carry over: "for 2 people" after booking on a date', async () => {
  const r = await turn({
    question: 'for 2 people',
    context: { focusTourId: PINK },
    history: [
      { role: 'user', content: `book pink city heritage trail on ${longDate(DEPART)}` },
      { role: 'assistant', content: 'One seat is priced.', intent: 'booking' },
    ],
  });
  assert.equal(r.state.intent, 'booking');
  assert.equal(r.quote.seatCount, 2);
  assert.equal(r.quote.date, DEPART);
});

test('"yes" and "ok what happens" continue the previous topic instead of starting a new search', async () => {
  for (const q of ['yes', 'ok what happens']) {
    const r = await turn({
      question: q,
      context: { focusTourId: PINK },
      history: [{ role: 'assistant', content: 'Want me to price it?', intent: 'booking' }],
    });
    assert.equal(r.state.intent, 'booking', q);
    assert.ok(r.quote, `${q} -> a price card`);
  }
});

test('"what happened?" explains the last step and runs no new lookup', async () => {
  const r = await turn({
    question: 'what happened?',
    context: { focusTourId: PINK, memory: { selectedTourId: PINK, selectedTourName: 'Pink City Heritage Trail', lastIntent: 'booking', lastTool: 'price_quote', lastStatus: 'needs_input', pendingAction: 'provide_date', missingFields: ['travelDate'] } },
    history: [{ role: 'assistant', content: 'Which day?', intent: 'booking' }],
  });
  assert.equal(r.state.intent, 'followup');
  assert.equal(r.calls.length, 0, 'no tool ran');
  assert.match(r.seen.prompt, /CONVERSATION SO FAR: .*tour=Pink City Heritage Trail.*waiting_for=travelDate/);
  assert.match(r.seen.prompt, /asking what just happened/);
  assert.ok(!r.called('listTours'));
});

test('"yes" with no history at all still answers (shows tours) rather than failing', async () => {
  const r = await turn({ question: 'yes' });
  assert.ok(r.tokens.length > 0);
});

/* ------------------------------------------------------------- no tour known / no match */

test('wants to book but no tour anywhere: shows tours to pick, never a dead-end question', async () => {
  const r = await turn({ question: 'i want to book tours' });
  assert.equal(r.called('quote'), false);
  assert.equal(r.blocks[0].type, 'tour_cards');
  assert.match(r.seen.prompt, /have not chosen a tour/);
});

test('"is there any seat available" with no tour also offers tours to choose from', async () => {
  const r = await turn({ question: 'is there any seat available or not' });
  assert.equal(r.blocks[0].type, 'tour_cards');
  assert.match(r.seen.prompt, /have not chosen a tour/);
});

test('"tour in ballia" with none there: says so and still shows real tours', async () => {
  const r = await turn({
    question: 'is there any tour in ballia',
    tours: ({ q }) => (q ? { total: 0, items: [] } : { total: 1, items: [{ id: PINK, title: 'Pink City Heritage Trail', slug: 'pink-city-heritage-trail', tour_type: 'HERITAGE', base_price: '8499.00', duration_days: 3, duration_nights: 2 }] }),
  });
  assert.equal(r.calls.filter((c) => c.name === 'listTours').length, 2, 'retried without the term');
  assert.match(r.seen.prompt, /no tours matching "ballia"/);
  assert.equal(r.blocks[0].type, 'tour_cards');
});

test('"which tour is near my location" finds the traveller\'s city, then its tours', async () => {
  const r = await turn({ question: 'which tour is near my location', context: { location: { lat: 25.76, lng: 84.14 } } });
  assert.equal(r.calls.find((c) => c.name === 'findNearby').args[0].radiusMeters, 50000);
  assert.equal(r.calls.find((c) => c.name === 'listTours').args[0].q, 'Varanasi');
});

test('without a location it asks them to tap the button', async () => {
  const r = await turn({ question: 'which tour is near my location' });
  assert.match(r.seen.prompt, /Use my location/);
});

/* ------------------------------------------------------------- blank / cut-off / failing model */

test('model returns nothing -> the traveller still gets a real answer from the data', async () => {
  const r = await turn({
    question: `i want to book pink city heritage trail on ${longDate(DEPART)}`,
    stream: async () => '',
  });
  assert.ok(r.state.answer.length > 20);
  assert.match(r.state.answer, /8,499|₹/);
  assert.equal(r.tokens, r.state.answer, 'what is stored is what was streamed');
  assert.ok(r.warnings.some(([, msg]) => /no text/.test(msg)));
});

test('model whitespace-only is treated as empty', async () => {
  const r = await turn({ question: 'cheapest tour', stream: async (_m, { onToken }) => { onToken('  \n'); return '  \n'; } });
  assert.ok(r.state.answer.trim().length > 0);
});

test('model throws (rate limit, outage) -> answer from the data, not an error', async () => {
  const r = await turn({ question: 'i want to book tours', stream: async () => { throw new Error('LLM 429'); } });
  assert.match(r.state.answer, /Pink City Heritage Trail/);
  assert.ok(r.warnings.some(([, msg]) => /model call failed/.test(msg)));
});

test('model fails mid-sentence -> what already reached the browser is kept, not duplicated', async () => {
  const r = await turn({
    question: 'cheapest tour',
    stream: async (_m, { onToken }) => { onToken('The cheapest is '); throw new Error('socket hang up'); },
  });
  assert.equal(r.state.answer, 'The cheapest is ');
  assert.equal(r.tokens, 'The cheapest is ');
});

test('hitting the token limit is logged', async () => {
  const r = await turn({
    question: 'cheapest tour',
    stream: async (_m, { onToken, onFinish }) => { onToken('Short answer'); onFinish('length'); return 'Short answer'; },
  });
  assert.ok(r.warnings.some(([, msg]) => /token limit/.test(msg)));
});

test('an aborted request (traveller left) is not turned into a fallback answer', async () => {
  const controller = new AbortController();
  const { deps } = makeDeps();
  const graph = buildAssistantGraph({
    tools: buildTools(deps),
    llm: { configured: false, completeJson: async () => '', stream: async () => { controller.abort(); throw new Error('aborted'); } },
    resolveTour: createTourResolver({ db: { query: async () => ({ rows: CATALOG }) } }),
  });
  await assert.rejects(() => graph.invoke(
    { question: 'cheapest tour', history: [], context: { tourId: null, user: null, location: null, focusTourId: null } },
    { configurable: { emit: () => {}, signal: controller.signal } }
  ));
});

/* ------------------------------------------------------------- what the model is told */

test('the prompt no longer promises a human follow-up that does not exist', async () => {
  const r = await turn({ question: 'is there any tour in ballia' });
  assert.ok(!/operations team/i.test(r.seen.system + r.seen.prompt));
  assert.match(r.seen.system, /NEVER say you will check with a team/);
});

/* ------------------------------------------------------------- resolver + fallback units */

test('resolver: unknown slug falls back to the name; one common word is never enough', async () => {
  const resolver = createTourResolver({ db: { query: async () => ({ rows: CATALOG }) } });
  assert.equal((await resolver.resolve('see /tours/nope and kashi heritage walk please'))?.tourId, KASHI);
  assert.equal(await resolver.resolve('any heritage tours?'), null);
  assert.equal(await resolver.resolve('hello'), null);
  assert.equal((await resolver.describe(PINK))?.title, 'Pink City Heritage Trail');
  assert.equal(await resolver.describe('missing'), null);
});

test('resolver: the catalogue is cached, then refreshed after the ttl', async () => {
  let now = 0; let queries = 0;
  const resolver = createTourResolver({ db: { query: async () => (queries++, { rows: CATALOG }) }, ttlMs: 1000, clock: () => now });
  await resolver.resolve('a'); await resolver.resolve('b'); await resolver.describe(PINK);
  assert.equal(queries, 1);
  now = 1500; await resolver.resolve('c');
  assert.equal(queries, 2);
});

test('fallback answers use only tool data and never promise follow-up', () => {
  const cases = [
    [{ needsLocation: true }, /Use my location/],
    [{ totalAmount: '16998.00', seatCount: 2, tour: 'Pink City Heritage Trail', date: '2026-12-01' }, /16,998/],
    [{ chooseTour: true, tours: [{ title: 'A' }, { title: 'B' }] }, /Pick one below: A, B/],
    [{ dates: [{ date: '2026-12-01', seatsLeft: 3 }] }, /2026-12-01 \(3 left\)/],
    [{ offers: [] }, /no offers/],
    [{ noMatchForTerm: 'ballia', tours: [{ title: 'A' }] }, /could not find tours for “ballia”/],
  ];
  for (const [data, expected] of cases) {
    const answer = fallbackAnswer({ toolResults: [{ ok: true, data }] });
    assert.match(answer, expected);
    assert.ok(!/operations team|get back to you|let you know/i.test(answer));
  }
  assert.match(fallbackAnswer({ toolResults: [] }), /try asking in a different way/);
});
