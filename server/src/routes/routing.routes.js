import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler, validate } from '../middleware/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { buildMoodRoute, optimiseTour } from '../services/osrm.service.js';
import { queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';

export const routingRouter = Router();
routingRouter.use(optionalAuth);

// OSRM is CPU-bound; protect a self-hosted instance from a hot loop in the UI.
const routeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7' });

const point = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * Personal Tour Mode — mood-based route. `fastest` is a plain OSRM route;
 * every other mood picks waypoints by PostGIS score first.
 */
routingRouter.post(
  '/route',
  routeLimiter,
  validate(
    'body',
    z.object({
      from: point,
      to: point,
      mood: z.enum(['scenic', 'quiet', 'fastest', 'food']).default('scenic'),
      profile: z.enum(['foot', 'bike', 'car']).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const route = await buildMoodRoute(req.body);
    // Same inputs give the same line for a while; let the browser reuse it.
    res.set('cache-control', 'private, max-age=120');
    res.json(route);
  })
);

/** Guided Tour Mode — the guide's saved route, or an optimised order of stops. */
routingRouter.get(
  '/guided/:slotId',
  validate('params', z.object({ slotId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const slot = await queryOne(
      `SELECT s.id, s.route_geojson, s.guide_id, u.full_name AS guide_name, s.tour_id
         FROM tour_slots s
         LEFT JOIN users u ON u.id = s.guide_id
        WHERE s.id = $1`,
      [req.params.slotId]
    );
    if (!slot) throw notFound('Departure not found');

    if (slot.route_geojson) {
      return res.json({
        source: 'guide',
        guideName: slot.guide_name,
        geometry: slot.route_geojson,
      });
    }

    // No curated route: optimise the tour's own stops (OSRM /trip solves the TSP).
    const stops = await queryOne(
      `SELECT json_agg(json_build_object(
                'lat', ST_Y(a.location), 'lng', ST_X(a.location), 'name', a.name)
              ORDER BY ta.visit_order) AS stops
         FROM tour_attractions ta
         JOIN attractions a ON a.id = ta.attraction_id
        WHERE ta.tour_id = $1`,
      [slot.tour_id]
    );
    if (!stops?.stops?.length) throw notFound('This tour has no mapped stops yet');

    const trip = await optimiseTour({ stops: stops.stops });
    res.json({
      source: 'optimised',
      guideName: slot.guide_name,
      stops: trip.order.map((i) => stops.stops[i]),
      ...trip,
    });
  })
);
