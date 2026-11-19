import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heuristicClassify,
  extractEntities,
  resolveDateRange,
  classifyIntent,
} from '../src/assistant/intent.js';

// Thursday 19 Nov 2026, noon IST.
const NOW = new Date('2026-11-19T06:30:00Z');

test('obvious questions resolve by rules with high confidence', () => {
  assert.deepEqual(heuristicClassify('What is the refund policy?'), { intent: 'rag', confidence: 0.9 });
  assert.equal(heuristicClassify('How many seats are left?').intent, 'live');
  assert.equal(heuristicClassify('Any discount coupons running?').intent, 'live');
  assert.equal(heuristicClassify('hello!').intent, 'smalltalk');
  assert.equal(heuristicClassify('cheapest heritage tour').intent, 'discover');
});

test('smalltalk: greetings and thanks, but never a greeting with a real question', () => {
  for (const q of ['hello there', 'Hi!', 'hey team', 'good morning', 'thank you so much', 'thanks a lot!', 'ok', 'bye']) {
    assert.equal(heuristicClassify(q).intent, 'smalltalk', q);
    assert.equal(heuristicClassify(q).confidence, 0.95, q);
  }
  assert.equal(heuristicClassify('hi, any seats left?').intent, 'live');
  assert.equal(heuristicClassify('hello what is the refund policy').intent, 'rag');
  assert.notEqual(heuristicClassify('thanks, how much for 2 people?').intent, 'smalltalk');
});

test('money questions outrank inventory questions when both match', () => {
  const r = heuristicClassify('How much for 3 people, any seats on Saturday?');
  assert.equal(r.intent, 'booking');
  assert.ok(r.confidence < 0.7, 'multi-match should be low confidence');
});

test('unmatched text defaults by context: tour page -> rag, central -> discover', () => {
  assert.equal(heuristicClassify('hmm interesting', { tourId: 'abc' }).intent, 'rag');
  assert.equal(heuristicClassify('hmm interesting', { tourId: null }).intent, 'discover');
});

test('entities: seat count, price cap, booking id', () => {
  assert.equal(extractEntities('price for 4 people', NOW).seatCount, 4);
  assert.equal(extractEntities('book for 2', NOW).seatCount, 2);
  assert.equal(extractEntities('a 3 days trip', NOW).seatCount, undefined, 'days are not seats');
  assert.equal(extractEntities('tours under ₹5,000', NOW).maxPrice, 5000);
  const id = '7d1f2c3a-1b2c-4d5e-8f90-123456789abc';
  assert.equal(extractEntities(`status of ${id}`, NOW).bookingId, id);
});

test('dates: today, tomorrow, weekend, ISO — resolved in IST', () => {
  assert.deepEqual(resolveDateRange('today', NOW), { from: '2026-11-19', to: '2026-11-19' });
  assert.deepEqual(resolveDateRange('tomorrow', NOW), { from: '2026-11-20', to: '2026-11-20' });
  assert.deepEqual(resolveDateRange('this weekend', NOW), { from: '2026-11-21', to: '2026-11-22' });
  assert.deepEqual(resolveDateRange('on 2026-12-25', NOW), { from: '2026-12-25', to: '2026-12-25' });
  assert.equal(resolveDateRange('sometime', NOW), null);
});

test('IST boundary: 20:00 UTC is already tomorrow in India', () => {
  const lateUtc = new Date('2026-11-19T20:00:00Z'); // 01:30 IST on the 20th
  assert.deepEqual(resolveDateRange('today', lateUtc), { from: '2026-11-20', to: '2026-11-20' });
});

test('LLM is skipped when rules are confident', async () => {
  let called = 0;
  const llm = { configured: true, completeJson: async () => (called++, '{"intent":"live"}') };
  const r = await classifyIntent({ question: 'refund policy?', context: { tourId: null }, llm, now: NOW });
  assert.equal(r.intent, 'rag');
  assert.equal(r.source, 'rules');
  assert.equal(called, 0);
});

test('LLM breaks ties for ambiguous questions', async () => {
  const llm = { configured: true, completeJson: async () => '{"intent":"live"}' };
  const r = await classifyIntent({
    question: 'How much for 3 people, any seats on Saturday?',
    context: { tourId: null },
    llm,
    now: NOW,
  });
  assert.equal(r.intent, 'live');
  assert.equal(r.source, 'llm');
});

test('LLM failure or garbage falls back to the rules guess', async () => {
  const q = 'How much for 3 people, any seats on Saturday?';
  for (const completeJson of [
    async () => { throw new Error('timeout'); },
    async () => 'not json',
    async () => '{"intent":"drop_all_tables"}',
  ]) {
    const r = await classifyIntent({ question: q, context: { tourId: null }, llm: { configured: true, completeJson }, now: NOW });
    assert.equal(r.intent, 'booking');
    assert.equal(r.source, 'rules');
  }
});

test('no LLM configured: rules only', async () => {
  const r = await classifyIntent({ question: 'hmm', context: { tourId: null }, llm: { configured: false }, now: NOW });
  assert.equal(r.source, 'rules');
});
