import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupePlaces,
  haversineMeters,
  isSamePlace,
  nameSimilarity,
  normalizePlace,
  parseDuration,
  PLACE_GROUPS,
  TABLE_B_RESPONSE_ONLY,
  acceptsPlace,
  requestTypes,
} from '../src/services/places.logic.js';

const AMBER = { lat: 26.9855, lng: 75.8513 };

test('haversine: ~111 km per degree of latitude, zero for identical points', () => {
  assert.equal(Math.round(haversineMeters(AMBER, AMBER)), 0);
  const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111_195) < 200, `got ${d}`);
});

test('parseDuration reads protobuf durations and rejects junk', () => {
  assert.equal(parseDuration('540s'), 540);
  assert.equal(parseDuration('12.6s'), 13);
  assert.equal(parseDuration(undefined), null);
  assert.equal(parseDuration('9 min'), null);
});

test('normalizePlace never invents ratings, hours or photos', () => {
  const p = normalizePlace(
    { id: 'abc', displayName: { text: 'Chai Stall' }, location: { latitude: 26.9, longitude: 75.8 } },
    'cafes',
    { lat: 26.9, lng: 75.8 }
  );
  assert.equal(p.rating, null);
  assert.equal(p.ratingCount, null);
  assert.equal(p.openNow, null);
  assert.equal(p.photo, null);
  assert.equal(p.source, 'google');
  assert.equal(p.id, 'g:abc');
  assert.equal(p.straightLineMeters, 0);
});

test('normalizePlace drops entries without a usable location or id', () => {
  assert.equal(normalizePlace({ id: 'x', displayName: { text: 'No loc' } }, 'cafes', null), null);
  assert.equal(normalizePlace({ location: { latitude: 1, longitude: 1 } }, 'cafes', null), null);
});

test('openNow is only ever a real boolean from Google', () => {
  const base = { id: 'a', displayName: { text: 'A' }, location: { latitude: 1, longitude: 1 } };
  assert.equal(normalizePlace({ ...base, currentOpeningHours: { openNow: false } }, 'cafes').openNow, false);
  assert.equal(normalizePlace({ ...base, currentOpeningHours: {} }, 'cafes').openNow, null);
});

test('name similarity ignores case, accents and filler words', () => {
  assert.ok(nameSimilarity('Amber Fort', 'AMBER FORT') === 1);
  assert.ok(nameSimilarity('The Café Lounge', 'cafe lounge') === 1);
  assert.ok(nameSimilarity('Amber Fort', 'Hawa Mahal') === 0);
});

test('isSamePlace needs both proximity and a matching name', () => {
  const curated = { name: 'Amber Fort', ...AMBER };
  // Same name, 60 m away → same place.
  assert.equal(isSamePlace(curated, { name: 'Amber Fort', lat: AMBER.lat + 0.0005, lng: AMBER.lng }), true);
  // "Amer Fort Jaipur" contains-match style naming still resolves nearby.
  assert.equal(isSamePlace(curated, { name: 'Amber Fort Jaipur', lat: AMBER.lat + 0.0005, lng: AMBER.lng }), true);
  // Same name but 5 km away (a different branch/city) → different place.
  assert.equal(isSamePlace(curated, { name: 'Amber Fort', lat: AMBER.lat + 0.05, lng: AMBER.lng }), false);
  // Adjacent but unrelated (the chai stall at the gate) → different place.
  assert.equal(isSamePlace(curated, { name: 'Gate Chai Stall', lat: AMBER.lat + 0.0003, lng: AMBER.lng }), false);
});

test('dedupePlaces: curated wins and repeated Place IDs collapse', () => {
  const curated = [{ id: 'c1', name: 'Amber Fort', ...AMBER }];
  const g = (placeId, name, dLat = 0) => ({ placeId, name, lat: AMBER.lat + dLat, lng: AMBER.lng });
  const { places, droppedAsCurated } = dedupePlaces(
    [g('p1', 'Amber Fort', 0.0004), g('p2', 'Anokhi Cafe', 0.003), g('p2', 'Anokhi Cafe', 0.003)],
    curated
  );
  assert.deepEqual(places.map((p) => p.placeId), ['p2']);
  assert.equal(droppedAsCurated, 1);
});

test('every group has searches, a label and a kind', () => {
  for (const [key, g] of Object.entries(PLACE_GROUPS)) {
    assert.ok(g.label && g.kind, key);
    assert.ok(g.searches.length > 0, key);
    for (const sr of g.searches) {
      assert.ok(Boolean(sr.types?.length) !== Boolean(sr.textQuery), `${key}: each search is types xor textQuery`);
    }
  }
});

test('no group ever requests a Table B (response-only) type', () => {
  for (const t of requestTypes()) assert.ok(!TABLE_B_RESPONSE_ONLY.includes(t), `${t} is response-only`);
});

test('acceptsPlace: temple regression, rides strictness, normalize keeps unknowns null', () => {
  const raw = (o) => ({ id: 'x', displayName: { text: o.name ?? 'Place' }, location: { latitude: 1, longitude: 1 }, ...o });
  assert.equal(acceptsPlace(raw({ primaryType: 'hindu_temple', types: ['hindu_temple'] }), 'temples'), true);
  assert.equal(acceptsPlace(raw({ primaryType: 'restaurant', types: ['restaurant'], name: 'Temple Cafe' }), 'temples'), false);
  assert.equal(acceptsPlace(raw({ name: 'Fort', types: ['tourist_attraction'] }), 'rides'), false);
  assert.equal(acceptsPlace(raw({ name: 'Nahargarh Ropeway', types: ['tourist_attraction'] }), 'rides'), true);
  const n = normalizePlace(raw({ types: ['tourist_attraction'] }), 'attractions', null);
  assert.equal(n.rating, null);
  assert.equal(n.priceLevel, null);
  assert.equal(n.openNow, null);
});
