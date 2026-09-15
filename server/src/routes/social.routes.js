import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler, validate } from '../middleware/index.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import * as social from '../services/social.service.js';
import { queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';

export const socialRouter = Router();

const uuid = z.string().uuid();
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7' });

// Reading reviews and threads is guest-visible.
socialRouter.get(
  '/tours/:tourId/reviews',
  optionalAuth,
  validate('params', z.object({ tourId: uuid })),
  validate(
    'query',
    z.object({
      limit: z.coerce.number().int().min(1).max(50).default(10),
      offset: z.coerce.number().int().min(0).default(0),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json({
      items: await social.listReviews({
        tourId: req.params.tourId,
        viewerId: req.user?.id,
        ...req.query,
      }),
    });
  })
);

socialRouter.get(
  '/reviews/:reviewId/comments',
  optionalAuth,
  validate('params', z.object({ reviewId: uuid })),
  asyncHandler(async (req, res) => {
    // Flat list in `path` order + depth — the client indents, no tree building.
    res.json({
      items: await social.listComments({
        reviewId: req.params.reviewId,
        viewerId: req.user?.id,
      }),
    });
  })
);

socialRouter.post(
  '/tours/:tourId/reviews',
  requireAuth,
  writeLimiter,
  validate('params', z.object({ tourId: uuid })),
  validate(
    'body',
    z.object({
      rating: z.number().int().min(1).max(5),
      content: z.string().trim().max(4000).default(''),
      // Only storage URLs — media itself lives in Cloudinary/S3, never in Postgres.
      mediaUrls: z.array(z.string().url().max(500)).max(10).default([]),
    })
  ),
  asyncHandler(async (req, res) => {
    const review = await social.createReview({
      userId: req.user.id,
      tourId: req.params.tourId,
      ...req.body,
    });
    res.status(201).json({ review });
  })
);

socialRouter.post(
  '/reviews/:reviewId/comments',
  requireAuth,
  writeLimiter,
  validate('params', z.object({ reviewId: uuid })),
  validate(
    'body',
    z.object({
      parentId: uuid.optional(),
      content: z.string().trim().min(1).max(2000),
    })
  ),
  asyncHandler(async (req, res) => {
    const comment = await social.addComment({
      reviewId: req.params.reviewId,
      userId: req.user.id,
      ...req.body,
    });
    res.status(201).json({ comment });
  })
);

socialRouter.delete(
  '/comments/:commentId',
  requireAuth,
  validate('params', z.object({ commentId: uuid })),
  asyncHandler(async (req, res) => {
    await social.softDeleteComment({
      commentId: req.params.commentId,
      userId: req.user.id,
      role: req.user.role,
    });
    res.status(204).end();
  })
);

socialRouter.post(
  '/reviews/:reviewId/like',
  requireAuth,
  writeLimiter,
  validate('params', z.object({ reviewId: uuid })),
  asyncHandler(async (req, res) => {
    res.json(await social.toggleReviewLike({ reviewId: req.params.reviewId, userId: req.user.id }));
  })
);

socialRouter.post(
  '/comments/:commentId/like',
  requireAuth,
  writeLimiter,
  validate('params', z.object({ commentId: uuid })),
  asyncHandler(async (req, res) => {
    res.json(
      await social.toggleCommentLike({ commentId: req.params.commentId, userId: req.user.id })
    );
  })
);

// ------------------------------------------------------------------ wishlist
socialRouter.get(
  '/wishlist',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ items: await social.listWishlist(req.user.id) });
  })
);

socialRouter.post(
  '/wishlist/:tourId',
  requireAuth,
  validate('params', z.object({ tourId: uuid })),
  asyncHandler(async (req, res) => {
    const tour = await queryOne('SELECT 1 FROM tours WHERE id = $1 AND is_published', [
      req.params.tourId,
    ]);
    if (!tour) throw notFound('Tour not found');
    res.json(await social.toggleWishlist({ userId: req.user.id, tourId: req.params.tourId }));
  })
);
