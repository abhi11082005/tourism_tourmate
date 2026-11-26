import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPlaces, filterPlaces } from '../src/lib/placeFilters.js';

const g = (id, rating, ratingCount, d, extra = {}) => ({ id, source: 'google', name: id, rating, ratingCount, straightLineMeters: d, ...extra });
const P = [g('a', 4.2, 10, 300), g('b', null, null, 100), g('c', 4.9, 5000, 900), g('d', 3.1, 800, 500)];

test('nearest / farthest', () => {
  assert.deepEqual(sortPlaces(P, 'nearest').map((p) => p.id), ['b', 'a', 'd', 'c']);
  assert.deepEqual(sortPlaces(P, 'farthest').map((p) => p.id), ['c', 'd', 'a', 'b']);
});

test('ratings: unknown always last in both directions', () => {
  assert.deepEqual(sortPlaces(P, 'rating_desc').map((p) => p.id), ['c', 'a', 'd', 'b']);
  assert.deepEqual(sortPlaces(P, 'rating_asc').map((p) => p.id), ['d', 'a', 'c', 'b']);
});

test('most reviewed, unknown last', () => {
  assert.deepEqual(sortPlaces(P, 'reviews_desc').map((p) => p.id), ['c', 'd', 'a', 'b']);
});

test('sorting does not mutate input', () => {
  const copy = [...P];
  sortPlaces(P, 'rating_desc');
  assert.deepEqual(P, copy);
});

test('min rating excludes unknown ratings and reports how many', () => {
  const r = filterPlaces(P, { minRating: 4 });
  assert.deepEqual(r.places.map((p) => p.id), ['a', 'c']);
  assert.equal(r.hiddenUnrated, 1);
});

test('open now requires a real true; radius applies', () => {
  const Q = [g('o', 4, 1, 100, { openNow: true }), g('u', 4, 1, 100), g('f', 4, 1, 100, { openNow: false })];
  assert.deepEqual(filterPlaces(Q, { openNow: true }).places.map((p) => p.id), ['o']);
  assert.deepEqual(filterPlaces(P, { radiusMeters: 400 }).places.map((p) => p.id), ['a', 'b']);
});

test('curated places are never hidden by Google-only filters', () => {
  const c = { id: 'c1', source: 'tourmate', name: 'C', rating: null, straightLineMeters: 50 };
  assert.equal(filterPlaces([c], { minRating: 4.5, openNow: true }).places.length, 1);
});

test('price filter keeps unknown price levels', () => {
  const Q = [g('x', 4, 1, 1, { priceLevel: 3 }), g('y', 4, 1, 1, { priceLevel: 1 }), g('z', 4, 1, 1)];
  assert.deepEqual(filterPlaces(Q, { maxPrice: 2 }).places.map((p) => p.id), ['y', 'z']);
});
