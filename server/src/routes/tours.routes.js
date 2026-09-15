import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/index.js';
import { optionalAuth } from '../middleware/auth.js';
import * as tours from '../services/tours.service.js';
import * as social from '../services/social.service.js';

export const tourRouter = Router();

// Guest mode: browsing needs no token, but optionalAuth lets us mark
// "liked by me" / "saved by me" when one is present.
tourRouter.use(optionalAuth);

const listQuery = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  tourType: z.string().max(40).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  maxDays: z.coerce.number().int().positive().optional(),
  sort: z.enum(['popular', 'price_asc', 'price_desc', 'newest']).default('popular'),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  offset: z.coerce.number().int().min(0).default(0),
});

tourRouter.get(
  '/',
  validate('query', listQuery),
  asyncHandler(async (req, res) => {
    res.set('cache-control', 'public, max-age=60');
    res.json(await tours.listTours(req.query));
  })
);

tourRouter.get(
  '/suggest',
  validate('query', z.object({ q: z.string().trim().min(2).max(60) })),
  asyncHandler(async (req, res) => {
    res.json({ items: await tours.suggestTours(req.query.q) });
  })
);

tourRouter.get(
  '/:slug',
  validate('params', z.object({ slug: z.string().min(1).max(140) })),
  asyncHandler(async (req, res) => {
    const tour = await tours.getTourBySlug(req.params.slug);
    const [ratings, reviews] = await Promise.all([
      tours.getRatingBreakdown(tour.id),
      social.listReviews({ tourId: tour.id, viewerId: req.user?.id, limit: 5 }),
    ]);
    res.json({ tour, ratings, reviews });
  })
);
