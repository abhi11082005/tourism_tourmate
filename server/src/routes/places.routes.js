import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler, validate } from '../middleware/index.js';
import { GROUP_KEYS } from '../services/places.logic.js';
import { requireGoogle } from '../services/google.service.js';
import * as places from '../services/places.service.js';

/*
 * External discovery (Google Places API New + Route Matrix). Public on purpose:
 * guests can discover nearby places without signing in. The limiter is per IP and
 * is the main brake on spend, together with the server-side cache.
 */
export const placesRouter = Router();

const placesLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
// Photos are one request per image on screen, so they get their own, larger bucket.
const photoLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false });

placesRouter.use((_req, _res, next) => {
  try {
    requireGoogle();
    next();
  } catch (err) {
    next(err);
  }
});

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

/** Tie a controller to the connection so an abandoned request stops the Google call. */
const abortOnClose = (req, res) => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort(new Error('client closed request'));
  });
  return controller.signal;
};

const isAbort = (err) => err?.name === 'AbortError' || err?.message === 'client closed request';
const quiet = (fn) =>
  asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (isAbort(err) || res.destroyed) return; // nobody is listening
      throw err;
    }
  });

const groupsParam = z
  .string()
  .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
  .pipe(z.array(z.enum(GROUP_KEYS)).min(1).max(6));

placesRouter.get(
  '/nearby',
  placesLimiter,
  validate(
    'query',
    z.object({
      lat,
      lng,
      radius: z.coerce.number().int().min(500).max(20_000).default(5_000),
      groups: groupsParam.default('attractions,restaurants,cafes'),
    })
  ),
  quiet(async (req, res) => {
    const { lat: la, lng: ln, radius, groups } = req.query;
    const result = await places.nearbyPlaces({
      lat: la,
      lng: ln,
      radiusMeters: radius,
      groups,
      signal: abortOnClose(req, res),
    });
    res.set('cache-control', 'private, max-age=60');
    res.json(result);
  })
);

placesRouter.get(
  '/search',
  placesLimiter,
  validate('query', z.object({ q: z.string().trim().min(2).max(80), lat, lng })),
  quiet(async (req, res) => {
    const { q, lat: la, lng: ln } = req.query;
    const items = await places.searchPlaces({ query: q, lat: la, lng: ln, signal: abortOnClose(req, res) });
    res.set('cache-control', 'private, max-age=60');
    res.json({ items });
  })
);

placesRouter.post(
  '/distances',
  placesLimiter,
  validate(
    'body',
    z.object({
      origin: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
      destinations: z
        .array(
          z.object({
            id: z.string().min(1).max(120),
            lat: z.coerce.number().min(-90).max(90),
            lng: z.coerce.number().min(-180).max(180),
          })
        )
        .min(1)
        .max(25),
      mode: z.enum(places.TRAVEL_MODES).default('walk'),
    })
  ),
  quiet(async (req, res) => {
    const items = await places.distances({ ...req.body, signal: abortOnClose(req, res) });
    res.set('cache-control', 'private, max-age=60');
    res.json({ items });
  })
);

// Declared before /:placeId so "photo" is never read as a Place ID.
placesRouter.get(
  '/photo',
  photoLimiter,
  validate(
    'query',
    z.object({
      // Photo resource names look like places/<placeId>/photos/<photoRef>.
      name: z.string().regex(/^places\/[A-Za-z0-9_-]{5,200}\/photos\/[A-Za-z0-9_-]{5,1000}$/),
      w: z.coerce.number().int().min(80).max(1600).default(480),
    })
  ),
  quiet(async (req, res) => {
    const uri = await places.photoUrl({
      name: req.query.name,
      maxWidthPx: req.query.w,
      signal: abortOnClose(req, res),
    });
    // The URL is short-lived; let the browser keep the redirect briefly, not forever.
    res.set('cache-control', 'private, max-age=600');
    res.redirect(302, uri);
  })
);

placesRouter.get(
  '/:placeId',
  placesLimiter,
  validate('params', z.object({ placeId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/) })),
  quiet(async (req, res) => {
    const place = await places.placeDetails({ placeId: req.params.placeId, signal: abortOnClose(req, res) });
    res.set('cache-control', 'private, max-age=300');
    res.json({ place });
  })
);
