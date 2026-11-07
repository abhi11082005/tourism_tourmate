// backend/src/routes/spotlight.routes.js
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/index.js';
import * as spotlights from '../services/spotlight.service.js';

export const spotlightRouter = Router();

// Reusable Zod schemas for coordinate validation
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

/**
 * @route   GET /api/spotlights/:id
 * @desc    Get spotlight details, coordinates, and distance from user
 * @access  Public (Guest mode accessible)
 */
spotlightRouter.get(
  '/:id',
  // Validate URL Parameter (id should be a positive integer)
  validate('params', z.object({ id: z.coerce.number().int().positive() })),
  // Validate Query Parameters (userLat and userLng are optional)
  validate(
    'query',
    z.object({
      userLat: lat.optional(),
      userLng: lng.optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    // Call the service with validated data
    const spotlight = await spotlights.getSpotlightDetails({
      id: req.params.id,
      userLat: req.query.userLat,
      userLng: req.query.userLng,
    });

    res.json(spotlight);
  })
); 