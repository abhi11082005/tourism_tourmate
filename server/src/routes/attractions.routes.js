import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/index.js';
import * as attractions from '../services/attractions.service.js';

export const attractionRouter = Router();

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

// "Near Me" — guest accessible; coordinates come from the browser, never stored.
attractionRouter.get(
  '/nearby',
  validate(
    'query',
    z.object({
      lat,
      lng,
      radius: z.coerce.number().int().min(100).max(50_000).default(5_000),
      category: z.enum(['MUST_VISIT', 'MUST_EAT', 'FAMOUS_RIDE']).optional(),
      moods: z
        .string()
        .optional()
        .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
  ),
  asyncHandler(async (req, res) => {
    const { lat: la, lng: ln, radius, category, moods, limit } = req.query;
    res.json({
      items: await attractions.findNearby({
        lat: la,
        lng: ln,
        radiusMeters: radius,
        category,
        moods,
        limit,
      }),
    });
  })
);

// Curated spotlight rails.
attractionRouter.get(
  '/category/:category',
  validate('params', z.object({ category: z.enum(['MUST_VISIT', 'MUST_EAT', 'FAMOUS_RIDE']) })),
  validate(
    'query',
    z.object({
      city: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(60).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    })
  ),
  asyncHandler(async (req, res) => {
    res.set('cache-control', 'public, max-age=300');
    res.json({
      items: await attractions.listByCategory({
        category: req.params.category,
        ...req.query,
      }),
    });
  })
);

// Viewport pins as GeoJSON — one request per pan, rendered as a Mapbox source.
attractionRouter.get(
  '/pins',
  validate(
    'query',
    z
      .object({
        west: lng,
        south: lat,
        east: lng,
        north: lat,
        category: z.enum(['MUST_VISIT', 'MUST_EAT', 'FAMOUS_RIDE']).optional(),
      })
      .refine((b) => b.east > b.west && b.north > b.south, {
        message: 'Bounds must be west<east and south<north',
      })
  ),
  asyncHandler(async (req, res) => {
    res.json(await attractions.pinsInBounds(req.query));
  })
);

attractionRouter.get(
  '/:id',
  validate('params', z.object({ id: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    res.json({ attraction: await attractions.getAttraction(req.params.id) });
  })
);
