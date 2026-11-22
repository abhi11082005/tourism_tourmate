import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDateRange, dateProblem, istDate, addDays, businessTimeZone } from '../src/assistant/dates.js';
import { extractEntities, classifyIntent, stickyEntities } from '../src/assistant/intent.js';
import { classifyData, classifyError, STATUS } from '../src/assistant/result.js';
import { readMemory, nextMemory, emptyMemory, memoryEntities } from '../src/assistant/memory.js';
import { buildAssistantGraph } from '../src/assistant/graph.js';
import { buildTools } from '../src/assistant/tools/index.js';
import { fallbackAnswer } from '../src/assistant/fallback.js';

// llm.js reads the validated env at import time; give it harmless values (nothing connects).
Object.assign(process.env, {
  DATABASE_URL: 'postgres://u:p@localhost:5432/x',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
  OSRM_BASE_URL: 'http://localhost:5000',
  LLM_PROVIDER: 'groq',
  LLM_API_KEY: 'k',
  LLM_MODEL: 'm',
});
const { createLlm } = await import('../src/assistant/llm.js');

/* ---------------------------------------------------------------- dates */

const at = (iso) => new Date(`${iso}T06:00:00Z`); // 11:30 IST: same calendar day everywhere
const SAT = '2026-11-21'; const SUN = '2026-11-22'; const WED = '2026-11-18';

test('dates: the four required formats', () => {
  assert.deepEqual(resolveDateRange('on 2026-11-21', at(WED)), { from: SAT, to: SAT });
  assert.deepEqual(resolveDateRange('Today please', at(WED)), { from: WED, to: WED });
  assert.deepEqual(resolveDateRange('tomorrow', at(WED)), { from: '2026-11-19', to: '2026-11-19' });
  assert.deepEqual(resolveDateRange('this weekend', at(WED)), { from: SAT, to: SUN });
});

test('dates: weekend already in progress never points at the past', () => {
  assert.deepEqual(resolveDateRange('this weekend', at(SAT)), { from: SAT, to: SUN }, 'Saturday: both days remain');
  assert.deepEqual(resolveDateRange('this weekend', at(SUN)), { from: SUN, to: SUN }, 'Sunday: only today is left');
  assert.deepEqual(resolveDateRange('this weekend', at('2026-11-20')), { from: SAT, to: SUN }, 'Friday');
});

test('dates: invalid and past dates are reported, not converted', () => {
  assert.equal(dateProblem('book on 2026-02-31', at(WED)).kind, 'invalid');
  assert.equal(dateProblem('31/04/2026 please', at(WED)).kind, 'invalid');
  assert.equal(dateProblem('book on 2026-13-01', at(WED)).kind, 'invalid');
  assert.equal(dateProblem('on 2026-11-01', at(WED)).kind, 'past');
  assert.equal(dateProblem('on 2026-11-21', at(WED)), null);
  const e = extractEntities('book on 2026-02-31', at(WED));
  assert.equal(e.dateRange, undefined);
  assert.equal(e.dateProblem.kind, 'invalid');
  assert.equal(extractEntities('on 2026-11-01', at(WED)).dateRange, undefined);
});

test('dates: timezone boundary — 23:30 UTC is already tomorrow in India', () => {
  const lateUtc = new Date('2026-11-20T23:30:00Z'); // 05:00 IST on the 21st
  assert.equal(istDate(lateUtc), '2026-11-21');
  assert.deepEqual(resolveDateRange('today', lateUtc), { from: SAT, to: SAT });
  assert.deepEqual(resolveDateRange('tomorrow', lateUtc), { from: SUN, to: SUN });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('dates: business timezone is configurable and a bad value falls back safely', () => {
  const old = process.env.BUSINESS_TZ;
  try {
    process.env.BUSINESS_TZ = 'America/Los_Angeles';
    assert.equal(istDate(new Date('2026-11-21T02:00:00Z')), '2026-11-20');
    process.env.BUSINESS_TZ = 'Not/AZone';
    assert.equal(businessTimeZone(), 'Asia/Kolkata');
  } finally {
    if (old === undefined) delete process.env.BUSINESS_TZ; else process.env.BUSINESS_TZ = old;
  }
});

/* ---------------------------------------------------------------- status contract */

test('status: a question is needs_input, nothing found is empty, zero seats is still a real answer', () => {
  assert.deepEqual(classifyData({ needsTour: true }), { status: STATUS.NEEDS_INPUT, missing: 'tour' });
  assert.deepEqual(classifyData({ chooseTour: true, tours: [{}] }), { status: STATUS.NEEDS_INPUT, missing: 'tour' });
  assert.equal(classifyData({ needsLocation: true }).missing, 'location');
  assert.equal(classifyData({ needsDay: ['a', 'b'] }).missing, 'travelDate');
  assert.equal(classifyData({ dateProblem: { kind: 'past' } }).missing, 'travelDate');
  assert.equal(classifyData({ requiresAuth: true }).missing, 'signIn');
  assert.equal(classifyData({ dates: [] }).status, STATUS.EMPTY);
  assert.equal(classifyData({ offers: [] }).status, STATUS.EMPTY);
  assert.equal(classifyData({ noDeparture: '2026-12-01' }).status, STATUS.EMPTY);
  assert.equal(classifyData({ couponProblem: 'expired' }).status, STATUS.EMPTY);
  assert.equal(classifyData({ dates: [{ seatsLeft: 0, soldOut: true }], allSoldOut: true }).status, STATUS.SUCCESS);
  assert.equal(classifyData({ totalAmount: '100' }).status, STATUS.SUCCESS);
});

test('status: errors become unavailable / failed with a message safe for the model', () => {
  const down = classifyError(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6379'), { code: 'ECONNREFUSED' }));
  assert.equal(down.status, STATUS.UNAVAILABLE);
  assert.ok(!/10\.0\.0\.5|6379/.test(down.publicMessage), 'no hosts or ports leak');
  const sql = classifyError(new Error('relation "tours" does not exist at character 15'));
  assert.equal(sql.status, STATUS.FAILED);
  assert.ok(!/relation|tours/.test(sql.publicMessage), 'no SQL leaks');
  assert.equal(classifyError(Object.assign(new Error('Booking not found'), { status: 404 })).publicMessage, 'Booking not found');
  assert.equal(classifyError(new Error('seat_availability timed out')).status, STATUS.UNAVAILABLE);
});

/* ---------------------------------------------------------------- memory */

test('memory: only adds or changes values, never blanks them', () => {
  const prev = { ...emptyMemory(), selectedTourId: 'T1', selectedTourName: 'Pink', travelDate: { from: SAT, to: SAT }, passengerCount: 2 };
  const after = nextMemory({ prev, intent: 'booking', entities: {}, tour: null, toolResults: [{ name: 'price_quote', ok: true, status: 'success' }] });
  assert.equal(after.travelDate.from, SAT);
  assert.equal(after.passengerCount, 2);
  assert.equal(after.selectedTourId, 'T1');
  assert.equal(after.lastTool, 'price_quote');
  assert.deepEqual(memoryEntities(after), { seatCount: 2, dateRange: { from: SAT, to: SAT } });
});

test('memory: a bad date is not remembered, a waiting question is', () => {
  const prev = emptyMemory();
  const m = nextMemory({
    prev, intent: 'booking',
    entities: { dateProblem: { kind: 'invalid' } },
    tour: { tourId: 'T1', title: 'Pink' },
    toolResults: [{ name: 'price_quote', ok: true, status: 'needs_input', missing: 'travelDate' }],
  });
  assert.equal(m.travelDate, null);
  assert.equal(m.pendingAction, 'provide_date');
  assert.deepEqual(m.missingFields, ['travelDate']);
});

test('memory: "what happened?" and small talk do not overwrite the last real operation', () => {
  const prev = { ...emptyMemory(), lastIntent: 'booking', lastTool: 'price_quote', lastStatus: 'needs_input', pendingAction: 'provide_date', missingFields: ['travelDate'] };
  for (const intent of ['followup', 'smalltalk']) {
    const m = nextMemory({ prev, intent, entities: {}, tour: null, toolResults: [] });
    assert.equal(m.lastIntent, 'booking');
    assert.equal(m.pendingAction, 'provide_date');
  }
});

test('memory: answering the question clears it; switching tour keeps date and seats', () => {
  const prev = { ...emptyMemory(), selectedTourId: 'T1', travelDate: { from: SAT, to: SAT }, passengerCount: 3, pendingAction: 'choose_tour', missingFields: ['tour'] };
  const m = nextMemory({ prev, intent: 'booking', entities: {}, tour: { tourId: 'T2', title: 'Kashi' }, toolResults: [{ name: 'price_quote', ok: true, status: 'success' }] });
  assert.equal(m.selectedTourId, 'T2');
  assert.equal(m.selectedTourName, 'Kashi');
  assert.equal(m.pendingAction, null);
  assert.equal(m.passengerCount, 3);
});

test('memory: junk read back from the database is sanitised', () => {
  const m = readMemory({ passengerCount: 99, travelDate: { from: 'x', to: 'y' }, selectedTourId: 5, missingFields: ['a', 7] });
  assert.equal(m.passengerCount, null);
  assert.equal(m.travelDate, null);
  assert.equal(m.selectedTourId, null);
  assert.deepEqual(m.missingFields, ['a']);
  assert.deepEqual(readMemory(null), emptyMemory());
});

test('memory beats raw history: details said many messages ago still apply', async () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'okay then', intent: i % 2 ? 'booking' : null }));
  const memory = { ...emptyMemory(), travelDate: { from: SAT, to: SAT }, passengerCount: 4 };
  const { entities } = await classifyIntent({ question: 'what is the final price?', context: { tourId: null }, history, memory, now: at(WED) });
  assert.equal(entities.seatCount, 4);
  assert.deepEqual(entities.dateRange, { from: SAT, to: SAT });
  assert.deepEqual(stickyEntities(history), {}, 'history alone would have lost them');
});

/* ---------------------------------------------------------------- whole graph */

const TOUR = '11111111-1111-4111-8111-111111111111';
const slot = (date, seats) => ({ slotId: `s-${date}`, date, isOpen: true, availableSeats: seats, priceModifier: '0.00' });
function graphWith(over = {}) {
  const calls = [];
  const deps = {
    tours: { listTours: async () => ({ total: 0, items: [] }) },
    attractions: { findNearby: async () => [] },
    rag: { embed: async () => [0], retrieve: async () => [] },
    db: { query: async () => ({ rows: [] }), queryOne: async () => ({ slug: 'k', title: 'Kashi', options: {} }) },
    booking: {
      getCalendar: async (a) => { calls.push(['calendar', a]); return [slot(addDays(istDate(new Date()), 5), 6)]; },
      quote: async ({ seatCount }) => ({ totalAmount: String(1000 * seatCount), breakdown: { lines: [] } }),
      getCheckoutState: async () => ({}),
    },
    offers: {
      activeCampaigns: async () => [],
      validateCoupon: async ({ couponCode, orderTotal }) => {
        if (couponCode === 'GONE') throw Object.assign(new Error('That coupon has expired'), { status: 400, code: 'COUPON_EXPIRED' });
        return { coupon: { code: couponCode }, discountAmount: '100.00', finalAmount: String(Number(orderTotal) - 100) };
      },
    },
    ...over,
  };
  const prompts = [];
  const warnings = [];
  const graph = buildAssistantGraph({
    tools: buildTools(deps),
    llm: { configured: false, completeJson: async () => { throw new Error('x'); }, stream: async (m, { onToken }) => { prompts.push(m.at(-1).content); onToken('ok'); return 'ok'; } },
    log: { warn: (...a) => warnings.push(a) },
  });
  return { graph, calls, prompts, warnings };
}
async function ask(g, question, context = {}, history = []) {
  const events = [];
  const state = await g.graph.invoke(
    { question, history, context: { tourId: TOUR, user: null, location: null, focusTourId: null, ...context } },
    { configurable: { emit: (event, data) => events.push({ event, data }) } }
  );
  return { state, events, blocks: events.filter((e) => e.event === 'ui').flatMap((e) => e.data) };
}

test('graph: missing tour is needs_input, and the state remembers what it is waiting for', async () => {
  const g = graphWith();
  const r = await ask(g, 'how many seats are left?', { tourId: null });
  const res = r.state.toolResults[0];
  assert.equal(res.ok, true);
  assert.equal(res.status, STATUS.NEEDS_INPUT);
  assert.equal(r.state.memory.pendingAction, 'choose_tour');
  assert.ok(r.events.some((e) => e.event === 'tool' && e.data.status === 'needs_input'));
});

test('graph: an invalid date asks again and calls no inventory service', async () => {
  const g = graphWith();
  const r = await ask(g, 'is there a seat on 2026-02-31?');
  assert.equal(r.state.toolResults[0].status, STATUS.NEEDS_INPUT);
  assert.equal(g.calls.length, 0, 'the database is never asked about a date that does not exist');
  assert.match(g.prompts[0], /not a real calendar date/);
  assert.equal(r.state.memory.travelDate, null);
});

test('graph: a past date is refused with a reason', async () => {
  const g = graphWith();
  const r = await ask(g, 'book on 2020-01-05');
  assert.equal(g.calls.length, 0);
  assert.match(g.prompts[0], /already passed/);
  assert.equal(r.blocks.length, 0, 'no price card for a date in the past');
});

test('graph: "book for this weekend" asks which day when the weekend still has two days', async () => {
  const w = resolveDateRange('this weekend'); // real clock: on a Sunday only today is left
  const g = graphWith();
  const r = await ask(g, 'I want to book this weekend');
  if (w.from === w.to) {
    assert.notEqual(r.state.toolResults[0].missing, 'travelDate', 'one day left: nothing to choose between');
    return;
  }
  assert.equal(r.state.toolResults[0].status, STATUS.NEEDS_INPUT);
  assert.equal(r.state.toolResults[0].missing, 'travelDate');
  assert.match(g.prompts[0], /Ask which day/);
  assert.equal(r.blocks.filter((b) => b.type === 'quote').length, 0);
  assert.equal(r.state.memory.pendingAction, 'provide_date');
});

test('graph: weekend availability lists both days', async () => {
  const g = graphWith();
  await ask(g, 'are seats available this weekend?');
  const { from, to } = g.calls[0][1];
  assert.ok(from <= to);
});

test('graph: zero seats left is a real answer, flagged as sold out', async () => {
  const day = addDays(istDate(new Date()), 3);
  const g = graphWith({ booking: { getCalendar: async () => [slot(day, 0)], quote: async () => ({}), getCheckoutState: async () => ({}) } });
  const r = await ask(g, 'any seats?');
  assert.equal(r.state.toolResults[0].status, STATUS.SUCCESS);
  assert.equal(r.state.toolResults[0].data.allSoldOut, true);
  assert.match(g.prompts[0], /sold out/);
});

test('graph: no price without a date is labelled as the standard price', async () => {
  const g = graphWith();
  const r = await ask(g, 'what is the final price for 2 people');
  assert.equal(r.state.toolResults[0].data.dateAssumed, true);
  assert.match(g.prompts[0], /standard price/);
  assert.equal(r.state.memory.passengerCount, 2);
});

test('graph: a live campaign is priced with the checkout rule and mentioned to the model', async () => {
  const g = graphWith({ offers: { activeCampaigns: async () => [{ id: 7, name: 'Diwali Dhamaka', discountPercent: 15 }], validateCoupon: async () => ({}) } });
  const r = await ask(g, 'what is the final price for 3 people');
  const c = r.state.toolResults[0].data.campaign;
  assert.deepEqual(c, { name: 'Diwali Dhamaka', percent: 15, saves: 450, payable: '2550' }); // floor(3000*15/100)
  assert.match(g.prompts[0], /Diwali Dhamaka.*15% off.*pay 2550 instead of 3000/);
});

test('graph: no campaign, or a failing campaign lookup, leaves the price untouched', async () => {
  const none = graphWith();
  assert.equal((await ask(none, 'final price')).state.toolResults[0].data.campaign, null);
  const broken = graphWith({ offers: { activeCampaigns: async () => { throw new Error('db down'); }, validateCoupon: async () => ({}) } });
  const r = await ask(broken, 'final price');
  assert.equal(r.state.toolResults[0].data.campaign, null);
  assert.equal(r.state.toolResults[0].ok, true);
});

test('graph: Redis/database outage is reported as unavailable, not as "checking"', async () => {
  const g = graphWith({ booking: { getCalendar: async () => { throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' }); }, quote: async () => ({}), getCheckoutState: async () => ({}) } });
  const r = await ask(g, 'any seats?');
  assert.equal(r.state.toolResults[0].status, STATUS.UNAVAILABLE);
  assert.ok(!/6379|ECONNREFUSED/.test(JSON.stringify(r.state.toolResults)), 'raw error stays out of model data');
  assert.match(g.prompts[0], /could not reach its data source/);
  assert.ok(g.warnings.some(([ctx]) => ctx.tool === 'seat_availability'), 'the real error is logged');
  assert.match(fallbackAnswer(r.state), /not reachable right now/);
});

test('graph: no offers is empty; coupon codes are not enumerated', async () => {
  const g = graphWith();
  const r = await ask(g, 'any offers or coupons?');
  const offers = r.state.toolResults.find((t) => t.name === 'active_offers');
  assert.equal(offers.status, STATUS.EMPTY);
  assert.match(g.prompts[0], /not listed publicly/);
});

test('graph: a valid coupon is priced with the real validator; an invalid one says why', async () => {
  const ok = graphWith();
  const r1 = await ask(ok, 'apply coupon SAVE10 for 2 people');
  const c = r1.state.toolResults.find((t) => t.name === 'check_coupon');
  assert.equal(c.data.finalAmount, '1900');
  assert.match(ok.prompts[0], /valid: it takes 100.00 off 2000/);

  const bad = graphWith();
  const r2 = await ask(bad, 'is coupon GONE valid?');
  const b = r2.state.toolResults.find((t) => t.name === 'check_coupon');
  assert.equal(b.status, STATUS.EMPTY);
  assert.match(bad.prompts[0], /expired/);
});

test('graph: coupon without a tour asks which tour', async () => {
  const g = graphWith();
  const r = await ask(g, 'apply coupon SAVE10', { tourId: null });
  const c = r.state.toolResults.find((t) => t.name === 'check_coupon');
  assert.equal(c.status, STATUS.NEEDS_INPUT);
});

test('graph: a failing coupon service is a failure, not an invalid coupon', async () => {
  const g = graphWith({ offers: { activeCampaigns: async () => [], validateCoupon: async () => { throw new Error('boom: select * from coupons'); } } });
  const r = await ask(g, 'apply coupon SAVE10');
  const c = r.state.toolResults.find((t) => t.name === 'check_coupon');
  assert.equal(c.status, STATUS.FAILED);
  assert.ok(!/select/.test(c.error));
});

test('multi-turn: date → travellers → price keeps tour, date and count through stored state', async () => {
  const g = graphWith();
  const day = addDays(istDate(new Date()), 5);
  let memory = null;
  const history = [];
  const say = async (q) => {
    const r = await ask(g, q, { tourId: null, focusTourId: TOUR, memory }, [...history]);
    memory = r.state.memory;
    history.push({ role: 'user', content: q }, { role: 'assistant', content: r.state.answer, intent: r.state.intent });
    return r;
  };
  await say(`book on ${day}`);
  assert.deepEqual(memory.travelDate, { from: day, to: day });
  await say('for 3 people');
  assert.equal(memory.passengerCount, 3);
  const r = await say('what is the final price?');
  const quote = r.blocks.find((b) => b.type === 'quote');
  assert.equal(quote.seatCount, 3);
  assert.equal(quote.date, day);
  assert.equal(memory.selectedTourId, TOUR);
});

test('reload: a conversation restored with stored state continues without repeating itself', async () => {
  const g = graphWith();
  const day = addDays(istDate(new Date()), 5);
  const stored = JSON.parse(JSON.stringify({ ...emptyMemory(), selectedTourId: TOUR, selectedTourName: 'Kashi', travelDate: { from: day, to: day }, passengerCount: 2, lastIntent: 'booking' }));
  const r = await ask(g, 'price please', { tourId: null, focusTourId: null, memory: stored }, [{ role: 'assistant', content: 'x', intent: 'booking' }]);
  const quote = r.blocks.find((b) => b.type === 'quote');
  assert.equal(quote.date, day);
  assert.equal(quote.seatCount, 2);
});

/* ---------------------------------------------------------------- LLM client */

function sse(text) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return { ok: true, status: 200, body: new Response(body).body };
}

test('llm: one 429 is retried and the answer still streams', async () => {
  let n = 0;
  const llm = createLlm({ retryDelayMs: 1, fetchImpl: async () => (++n === 1 ? { ok: false, status: 429 } : sse('hello')) });
  const tokens = [];
  assert.equal(await llm.stream([], { onToken: (t) => tokens.push(t) }), 'hello');
  assert.equal(n, 2);
});

test('llm: a hard failure (401) is not retried; two 5xx in a row give up', async () => {
  let n = 0;
  await assert.rejects(createLlm({ retryDelayMs: 1, fetchImpl: async () => (n++, { ok: false, status: 401 }) }).stream([], { onToken() {} }), /LLM 401/);
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(createLlm({ retryDelayMs: 1, fetchImpl: async () => (n++, { ok: false, status: 503 }) }).stream([], { onToken() {} }), /LLM 503/);
  assert.equal(n, 2);
});

test('llm: a provider that never answers is cut off by the time limit', async () => {
  // AbortSignal.timeout timers are unref'd (a real socket keeps the process alive); hold the loop open here.
  const hang = (_url, { signal }) => new Promise((_, reject) => {
    const keep = setTimeout(() => {}, 5000);
    signal.addEventListener('abort', () => { clearTimeout(keep); reject(signal.reason); });
  });
  const started = Date.now();
  await assert.rejects(createLlm({ streamTimeoutMs: 40, retryDelayMs: 1, fetchImpl: hang }).stream([], { onToken() {} }));
  assert.ok(Date.now() - started < 1000);
});

test('llm: a dropped connection before the first byte is retried once', async () => {
  let n = 0;
  const llm = createLlm({ retryDelayMs: 1, fetchImpl: async () => { if (++n === 1) throw new TypeError('fetch failed'); return sse('back'); } });
  assert.equal(await llm.stream([], { onToken() {} }), 'back');
});
