import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Separate file = separate process, so the frozen env here has no Google key.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/x';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.OSRM_BASE_URL = 'http://127.0.0.1:1';
process.env.GOOGLE_MAPS_SERVER_API_KEY = 'YOUR_SERVER_RESTRICTED_KEY'; // the shipped placeholder
process.env.LOG_LEVEL = 'silent';

let server;
let base;
let redis;

before(async () => {
  ({ redis } = await import('../src/db/redis.js'));
  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  redis.disconnect();
});

test('the example placeholder counts as "not configured"', async () => {
  const { googleMapsEnabled } = await import('../src/config/env.js');
  assert.equal(googleMapsEnabled, false);
});

test('places endpoints answer 503 GOOGLE_NOT_CONFIGURED, not a crash', async () => {
  for (const path of ['/api/places/nearby?lat=26&lng=75', '/api/places/ChIJabcdefghij1']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 503, path);
    assert.equal((await res.json()).error.code, 'GOOGLE_NOT_CONFIGURED');
  }
  const route = await fetch(`${base}/api/routing/google-route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: { lat: 1, lng: 1 }, to: { lat: 2, lng: 2 } }),
  });
  assert.equal(route.status, 503);
});
