import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, shouldAcceptFix, shouldCommitOrigin } from '../src/lib/geo.js';

const A = { lat: 26.9, lng: 75.8, accuracy: 10, at: 0 };
const moved = (m) => ({ ...A, lat: A.lat + m / 111_195 });

test('haversine ~111 km per degree', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111_195) < 200);
});

test('first fix accepted; jitter and rapid fixes throttled', () => {
  assert.equal(shouldAcceptFix(null, A), true);
  assert.equal(shouldAcceptFix(A, { ...moved(3), at: 10_000 }), false); // 3 m jitter
  assert.equal(shouldAcceptFix(A, { ...moved(50), at: 1_000 }), false); // too soon
  assert.equal(shouldAcceptFix(A, { ...moved(50), at: 10_000 }), true);
  assert.equal(shouldAcceptFix(A, { lat: NaN, lng: 1, at: 99_999 }), false);
});

test('a very coarse fix does not replace a good one', () => {
  assert.equal(shouldAcceptFix(A, { ...moved(500), accuracy: 900, at: 20_000 }), false);
});

test('route origin is not recommitted for small or fast moves', () => {
  const c = { ...A, at: 0 };
  assert.equal(shouldCommitOrigin(null, c), true);
  assert.equal(shouldCommitOrigin(c, { ...moved(40), at: 60_000 }), false);
  assert.equal(shouldCommitOrigin(c, { ...moved(400), at: 5_000 }), false);
  assert.equal(shouldCommitOrigin(c, { ...moved(400), at: 30_000 }), true);
});
