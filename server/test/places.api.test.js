import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * End-to-end through Express with Google's HTTP API replaced by a fetch stub. No
 * database or real key is involved. The env is set before the app is imported
 * because config/env.js freezes it on first load.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/x';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.OSRM_BASE_URL = 'http://127.0.0.1:1';
process.env.GOOGLE_MAPS_SERVER_API_KEY = 'TEST_KEY_do_not_leak_12345';
process.env.PLACES_CACHE_TTL_SECONDS = '0'; // every test sees fresh calls
process.env.LOG_LEVEL = 'silent';

const KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY;
const realFetch = globalThis.fetch;
let calls = [];
let handler = () => new Response('{}', { status: 200 });

let server;
let base;
let redis;
let places;

before(async () => {
  ({ redis } = await import('../src/db/redis.js'));
  places = await import('../src/services/places.service.js');
  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return realFetch(url, init); // our own test requests
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  server.close();
  redis.disconnect();
});

beforeEach(() => {
  calls = [];
  handler = () => new Response('{}', { status: 200 });
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const gPlace = (id, name, lat, lng, extra = {}) => ({
  id,
  displayName: { text: name },
  formattedAddress: `${name}, Jaipur`,
  location: { latitude: lat, longitude: lng },
  ...extra,
});

test('nearbyPlaces: field mask + key in headers only, radius enforced, curated de-duplicated', async () => {
  handler = (url) => {
    if (url.endsWith(':searchNearby')) {
      return json({
        places: [
          gPlace('P_FORT', 'Amber Fort', 26.9857, 75.8514, { rating: 4.6, userRatingCount: 9000, types: ['tourist_attraction'] }),
          gPlace('P_CAFE', 'Anokhi Park', 26.989, 75.852, { types: ['tourist_attraction'], currentOpeningHours: { openNow: true } }),
          gPlace('P_FAR', 'Far Away Fort', 27.2, 75.85, { types: ['tourist_attraction'] }), // ~24 km: outside a 5 km radius
        ],
      });
    }
    return json({ places: [] });
  };

  const out = await places.nearbyPlaces({
    lat: 26.9855,
    lng: 75.8513,
    radiusMeters: 5000,
    groups: ['attractions'],
    loadCurated: async () => [{ id: 'c1', name: 'Amber Fort', lat: 26.9855, lng: 75.8513 }],
  });

  assert.deepEqual(out.items.map((p) => p.placeId), ['P_CAFE']);
  assert.equal(out.droppedAsCurated, 1);
  assert.equal(out.items[0].openNow, true);
  assert.equal(out.items[0].rating, null); // not supplied → not invented

  const call = calls[0];
  assert.ok(call.init.headers['x-goog-fieldmask'].includes('places.displayName'));
  assert.equal(call.init.headers['x-goog-api-key'], KEY);
  assert.ok(!call.url.includes(KEY), 'key must never be in the URL');
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.locationRestriction.circle.radius, 5000);
  assert.ok(body.includedTypes.includes('tourist_attraction'));
});

test('nearbyPlaces: street food goes through Text Search with a bias circle', async () => {
  handler = () => json({ places: [gPlace('P_CHAAT', 'Rawat Kachori', 26.9, 75.8, { types: ['snack_bar'] })] });
  const out = await places.nearbyPlaces({
    lat: 26.9,
    lng: 75.8,
    radiusMeters: 1000,
    groups: ['street_food'],
    loadCurated: async () => [],
  });
  assert.ok(calls[0].url.endsWith(':searchText'));
  assert.equal(JSON.parse(calls[0].init.body).textQuery, 'street food');
  assert.equal(out.items[0].group, 'street_food');
});

test('nearbyPlaces: one failing group does not blank the rest; total failure throws', async () => {
  handler = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.includedTypes?.includes('restaurant')) return json({ error: { status: 'INTERNAL' } }, 500);
    return json({ places: [gPlace('P1', 'Hawa Mahal', 26.9239, 75.8267, { types: ['tourist_attraction'] })] });
  };
  const out = await places.nearbyPlaces({
    lat: 26.9239,
    lng: 75.8267,
    radiusMeters: 5000,
    groups: ['attractions', 'restaurants'],
    loadCurated: async () => [],
  });
  assert.deepEqual(out.failedGroups, ['restaurants']);
  assert.equal(out.items.length, 1);

  handler = () => json({ error: { status: 'PERMISSION_DENIED', message: 'nope' } }, 403);
  await assert.rejects(
    places.nearbyPlaces({ lat: 1, lng: 1, radiusMeters: 1000, groups: ['cafes'], loadCurated: async () => [] }),
    (err) => err.code === 'GOOGLE_AUTH' && err.status === 503
  );
});

test('GET /api/places/nearby validates input', async () => {
  const bad = await realFetch(`${base}/api/places/nearby?lat=999&lng=75`);
  assert.equal(bad.status, 422);
  const badGroup = await realFetch(`${base}/api/places/nearby?lat=26&lng=75&groups=casinos`);
  assert.equal(badGroup.status, 422);
  const tooWide = await realFetch(`${base}/api/places/nearby?lat=26&lng=75&radius=90000`);
  assert.equal(tooWide.status, 422);
  assert.equal(calls.length, 0, 'invalid requests must not reach Google');
});

test('GET /api/places/:placeId returns normalised details with explicit mask', async () => {
  handler = (url, init) => {
    assert.equal(init.method, 'GET');
    return json({
      ...gPlace('ChIJabcdefghij1', 'Hawa Mahal', 26.9239, 75.8267, { rating: 4.5, userRatingCount: 1234 }),
      regularOpeningHours: { weekdayDescriptions: ['Monday: 9:00 AM – 5:00 PM'] },
      photos: [{ name: 'places/ChIJabcdefghij1/photos/AUc7abcdef', authorAttributions: [{ displayName: 'A. Person' }] }],
    });
  };
  const res = await realFetch(`${base}/api/places/ChIJabcdefghij1`);
  assert.equal(res.status, 200);
  const { place } = await res.json();
  assert.equal(place.name, 'Hawa Mahal');
  assert.equal(place.rating, 4.5);
  assert.deepEqual(place.weekdayHours, ['Monday: 9:00 AM – 5:00 PM']);
  assert.equal(place.photos[0].attributions[0].name, 'A. Person');
  assert.ok(calls[0].init.headers['x-goog-fieldmask'].includes('regularOpeningHours.weekdayDescriptions'));
  assert.ok(!JSON.stringify(place).includes(KEY));

  const bad = await realFetch(`${base}/api/places/..%2Fadmin`);
  assert.ok([404, 422].includes(bad.status));
});

test('GET /api/places/photo redirects to the keyless Google URL and rejects bad names', async () => {
  handler = (url) => {
    assert.ok(url.includes('skipHttpRedirect=true'));
    return json({ name: 'x', photoUri: 'https://lh3.googleusercontent.com/places/abc=s480' });
  };
  const ok = await realFetch(`${base}/api/places/photo?name=${encodeURIComponent('places/ChIJabcdefghij1/photos/AUc7abcdef')}&w=400`, {
    redirect: 'manual',
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), 'https://lh3.googleusercontent.com/places/abc=s480');
  assert.ok(!ok.headers.get('location').includes(KEY));

  const bad = await realFetch(`${base}/api/places/photo?name=${encodeURIComponent('../../etc/passwd')}`);
  assert.equal(bad.status, 422);
});

test('POST /api/places/distances maps Route Matrix elements back to ids', async () => {
  handler = (url, init) => {
    assert.ok(url.endsWith('distanceMatrix/v2:computeRouteMatrix'));
    assert.equal(init.headers['x-goog-fieldmask'], 'originIndex,destinationIndex,distanceMeters,duration,condition');
    return json([
      { originIndex: 0, destinationIndex: 1, distanceMeters: 2100, duration: '1500s', condition: 'ROUTE_EXISTS' },
      { originIndex: 0, destinationIndex: 0, distanceMeters: 650, duration: '540s', condition: 'ROUTE_EXISTS' },
      { originIndex: 0, destinationIndex: 2, condition: 'ROUTE_NOT_FOUND' },
    ]);
  };
  const res = await realFetch(`${base}/api/places/distances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: { lat: 26.9, lng: 75.8 },
      mode: 'walk',
      destinations: [
        { id: 'a', lat: 26.905, lng: 75.8 },
        { id: 'b', lat: 26.92, lng: 75.8 },
        { id: 'c', lat: 26.93, lng: 75.8 },
      ],
    }),
  });
  assert.equal(res.status, 200);
  const { items } = await res.json();
  assert.deepEqual(items.map((i) => [i.id, i.distanceMeters, i.durationSeconds]), [
    ['a', 650, 540],
    ['b', 2100, 1500],
    ['c', null, null],
  ]);
  assert.ok(items[0].straightLineMeters > 0);

  const tooMany = await realFetch(`${base}/api/places/distances`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: { lat: 1, lng: 1 },
      destinations: Array.from({ length: 26 }, (_, i) => ({ id: String(i), lat: 1, lng: 1 })),
    }),
  });
  assert.equal(tooMany.status, 422);
});

test('POST /api/routing/google-route returns GeoJSON geometry; walking sends no routingPreference', async () => {
  handler = (url, init) => {
    assert.ok(url.endsWith('directions/v2:computeRoutes'));
    const body = JSON.parse(init.body);
    assert.equal(body.travelMode, 'WALK');
    assert.equal(body.routingPreference, undefined);
    assert.equal(body.polylineEncoding, 'GEO_JSON_LINESTRING');
    return json({
      routes: [{ distanceMeters: 650, duration: '540s', polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[75.8, 26.9], [75.81, 26.91]] } } }],
    });
  };
  const res = await realFetch(`${base}/api/routing/google-route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: { lat: 26.9, lng: 75.8 }, to: { lat: 26.91, lng: 75.81 }, mode: 'walk' }),
  });
  assert.equal(res.status, 200);
  const route = await res.json();
  assert.equal(route.provider, 'google');
  assert.equal(route.distanceMeters, 650);
  assert.equal(route.durationSeconds, 540);
  assert.equal(route.geometry.type, 'LineString');
});

test('google-route: driving asks for TRAFFIC_UNAWARE; an empty result is a 422, not a 500', async () => {
  handler = (url, init) => {
    assert.equal(JSON.parse(init.body).routingPreference, 'TRAFFIC_UNAWARE');
    return json({}); // Google answers {} when there is no route
  };
  const res = await realFetch(`${base}/api/routing/google-route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: { lat: 26.9, lng: 75.8 }, to: { lat: 26.91, lng: 75.81 }, mode: 'drive' }),
  });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'ROUTE_NOT_FOUND');
});

test('Google errors become stable codes and never echo Google bodies or the key', async () => {
  handler = () => json({ error: { status: 'RESOURCE_EXHAUSTED', message: `quota for key ${KEY}` } }, 429);
  const res = await realFetch(`${base}/api/places/search?q=chai&lat=26.9&lng=75.8`);
  const text = await res.text();
  assert.equal(res.status, 503);
  assert.ok(text.includes('GOOGLE_QUOTA'));
  assert.ok(!text.includes(KEY));
});

test('existing OSRM route endpoint is untouched by the new router', async () => {
  const res = await realFetch(`${base}/api/routing/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: { lat: 999, lng: 0 }, to: { lat: 1, lng: 1 } }),
  });
  assert.equal(res.status, 422); // still validated by its original schema
});

/* ---------------------------------------------------------- category engine */

const lastBodies = () => calls.map((c) => JSON.parse(c.init.body));

test('temples: no Table B type is ever sent, and all place types come back', async () => {
  const { TABLE_B_RESPONSE_ONLY } = await import('../src/services/places.logic.js');
  handler = (url, init) => {
    const body = JSON.parse(init.body);
    // Behave like Google: a response-only type is a hard 400.
    if (body.includedTypes?.some((t) => TABLE_B_RESPONSE_ONLY.includes(t))) {
      return json({ error: { status: 'INVALID_ARGUMENT', message: 'Unsupported types' } }, 400);
    }
    if (body.includedTypes?.includes('hindu_temple')) {
      return json({ places: [gPlace('T1', 'Birla Mandir', 26.89, 75.81, { primaryType: 'hindu_temple', types: ['hindu_temple', 'place_of_worship'] })] });
    }
    if (body.includedTypes?.includes('monument')) {
      return json({ places: [gPlace('M1', 'Jantar Mantar', 26.92, 75.82, { primaryType: 'monument', types: ['monument', 'tourist_attraction'] })] });
    }
    if (body.textQuery === 'gurudwara') {
      return json({ places: [gPlace('G1', 'Gurudwara Sahib', 26.9, 75.8, { types: ['place_of_worship'] })] });
    }
    return json({ places: [] });
  };
  const out = await places.nearbyPlaces({ lat: 26.9, lng: 75.8, radiusMeters: 20000, groups: ['temples'], loadCurated: async () => [] });
  assert.deepEqual(out.failedGroups, []);
  assert.deepEqual(out.items.map((p) => p.placeId).sort(), ['G1', 'M1', 'T1']);
  assert.ok(out.items.every((p) => p.kind === 'temple'));
  for (const b of lastBodies()) assert.ok(!b.includedTypes?.includes('place_of_worship'));
});

test('a rejected type list is retried once with the fallback list', async () => {
  let n = 0;
  handler = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.includedTypes?.includes('tea_house')) { n += 1; return json({ error: { status: 'INVALID_ARGUMENT' } }, 400); }
    return json({ places: [gPlace('C1', 'Blue Cafe', 26.9, 75.8, { primaryType: 'cafe', types: ['cafe'] })] });
  };
  const out = await places.nearbyPlaces({ lat: 26.9, lng: 75.8, radiusMeters: 5000, groups: ['cafes'], loadCurated: async () => [] });
  assert.equal(n, 1);
  assert.deepEqual(out.items.map((p) => p.placeId), ['C1']);
});

test('rides: only real rides pass; availability is never claimed', async () => {
  handler = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.textQuery === 'ropeway cable car') {
      return json({ places: [
        gPlace('R1', 'Mussoorie Ropeway', 26.9, 75.8, { types: ['tourist_attraction'] }),
        gPlace('X1', 'Ropeway View Hotel', 26.9, 75.8, { primaryType: 'hotel', types: ['hotel'] }),
        gPlace('X2', 'City Fort', 26.9, 75.8, { primaryType: 'tourist_attraction', types: ['tourist_attraction'] }),
      ] });
    }
    if (body.includedTypes?.includes('amusement_park')) {
      return json({ places: [gPlace('R2', 'Fun World', 26.9, 75.8, { primaryType: 'amusement_park', types: ['amusement_park'] })] });
    }
    return json({ places: [] });
  };
  const out = await places.nearbyPlaces({ lat: 26.9, lng: 75.8, radiusMeters: 20000, groups: ['rides'], loadCurated: async () => [] });
  assert.deepEqual(out.items.map((p) => p.placeId).sort(), ['R1', 'R2']);
  const r1 = out.items.find((p) => p.placeId === 'R1');
  assert.equal(r1.rideType, 'Ropeway / cable car');
  assert.equal(r1.availability, 'unverified');
  assert.equal(r1.priceLevel, null);
});

test('popular_food keeps only well-reviewed restaurants; unknown ratings are excluded', async () => {
  handler = () => json({ places: [
    gPlace('A', 'Great', 26.9, 75.8, { types: ['restaurant'], rating: 4.5, userRatingCount: 800 }),
    gPlace('B', 'Few reviews', 26.9, 75.8, { types: ['restaurant'], rating: 4.9, userRatingCount: 5 }),
    gPlace('C', 'Meh', 26.9, 75.8, { types: ['restaurant'], rating: 3.2, userRatingCount: 900 }),
    gPlace('D', 'Unrated', 26.9, 75.8, { types: ['restaurant'] }),
  ] });
  const out = await places.nearbyPlaces({ lat: 26.9, lng: 75.8, radiusMeters: 5000, groups: ['popular_food'], loadCurated: async () => [] });
  assert.deepEqual(out.items.map((p) => p.placeId), ['A']);
});

test('street food drops hotels and unrelated places', async () => {
  handler = () => json({ places: [
    gPlace('S1', 'Chaat Corner', 26.9, 75.8, { types: ['snack_bar'] }),
    gPlace('S2', 'Grand Hotel', 26.9, 75.8, { primaryType: 'hotel', types: ['hotel'] }),
    gPlace('S3', 'Bank', 26.9, 75.8, { types: ['bank'] }),
  ] });
  const out = await places.nearbyPlaces({ lat: 26.9, lng: 75.8, radiusMeters: 5000, groups: ['street_food'], loadCurated: async () => [] });
  assert.deepEqual(out.items.map((p) => p.placeId), ['S1']);
});

test('Google errors keep a stable code and a sanitised status', async () => {
  handler = () => json({ error: { status: 'INVALID_ARGUMENT', message: 'bad' } }, 400);
  await assert.rejects(
    places.nearbyPlaces({ lat: 1, lng: 1, radiusMeters: 1000, groups: ['restaurants'], loadCurated: async () => [] }),
    (err) => err.code === 'GOOGLE_BAD_REQUEST' && err.details?.googleStatus === 'INVALID_ARGUMENT'
  );
});
