import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../middleware/index.js';
import { requireAuth, requireRole, assertLiveRole } from '../middleware/auth.js';
import { query, queryOne } from '../db/pool.js';

export const adminRouter = Router();

// Every route below is admin-only, and the role is re-read from the database so a
// revoked admin cannot keep using an old token.
adminRouter.use(requireAuth, requireRole('ADMIN'), assertLiveRole);

const uuid = z.string().uuid();
const money = z.number().nonnegative().max(10_000_000);

/** Dashboard tiles: users, revenue, today's departures, upcoming payments. */
adminRouter.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    const row = await queryOne(
      `SELECT (SELECT COUNT(*)::int FROM users)                                    AS total_users,
              (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '30 days')
                                                                                  AS new_users_30d,
              (SELECT COUNT(*)::int FROM bookings WHERE status = 'CONFIRMED')      AS confirmed_bookings,
              (SELECT COALESCE(SUM(total_amount), 0) FROM bookings WHERE status = 'CONFIRMED')
                                                                                  AS gross_revenue,
              (SELECT COALESCE(SUM(total_amount), 0) FROM bookings
                WHERE status = 'CONFIRMED' AND created_at > NOW() - INTERVAL '30 days')
                                                                                  AS revenue_30d,
              (SELECT COUNT(*)::int FROM bookings
                WHERE status = 'CONFIRMED' AND booking_date = CURRENT_DATE)        AS departures_today,
              (SELECT COUNT(*)::int FROM bookings WHERE status = 'PENDING')        AS in_checkout`
    );

    const { rows: daily } = await query(
      `SELECT created_at::date::text AS date,
              COUNT(*)::int          AS bookings,
              SUM(total_amount)      AS revenue
         FROM bookings
        WHERE status = 'CONFIRMED' AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1`
    );

    res.json({ totals: row, daily });
  })
);

/** Package builder. options/itinerary/inclusions are free-form JSONB. */
adminRouter.post(
  '/tours',
  validate(
    'body',
    z.object({
      title: z.string().min(3).max(200),
      slug: z.string().regex(/^[a-z0-9-]+$/).max(140),
      overview: z.string().min(10),
      tourType: z.string().max(40).default('HERITAGE'),
      basePrice: money,
      totalSeats: z.number().int().min(1).max(500),
      durationDays: z.number().int().min(1).max(60),
      durationNights: z.number().int().min(0).max(60),
      itinerary: z.array(z.record(z.unknown())).default([]),
      inclusions: z.array(z.string()).default([]),
      exclusions: z.array(z.string()).default([]),
      options: z.record(z.record(z.unknown())).default({}),
      gallery: z.array(z.object({ url: z.string().url(), alt: z.string().optional() })).default([]),
      refundPolicy: z
        .array(z.object({ daysBefore: z.number().int(), refundPercent: z.number().min(0).max(100) }))
        .default([]),
      isPublished: z.boolean().default(false),
    })
  ),
  asyncHandler(async (req, res) => {
    const b = req.body;
    console.log('Creating tour', b.title, b.slug, b.basePrice, b.totalSeats, b.durationDays, b.durationNights);
    const tour = await queryOne(
      `INSERT INTO tours (title, slug, overview, tour_type, base_price, total_seats,
                          duration_days, duration_nights, itinerary, inclusions, exclusions,
                          options, gallery, refund_policy, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15)
       RETURNING id, slug, title, is_published`,
      [
        b.title, b.slug, b.overview, b.tourType, b.basePrice, b.totalSeats,
        b.durationDays, b.durationNights,
        JSON.stringify(b.itinerary), JSON.stringify(b.inclusions), JSON.stringify(b.exclusions),
        JSON.stringify(b.options), JSON.stringify(b.gallery), JSON.stringify(b.refundPolicy),
        b.isPublished,
      ]
    );
    res.status(201).json({ tour });
  })
);

/** Seat management: open dates in bulk and set capacity per date. */
adminRouter.post(
  '/tours/:tourId/slots',
  validate('params', z.object({ tourId: uuid })),
  validate(
    'body',
    z.object({
      dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(180),
      totalSeats: z.number().int().min(1).max(500),
      priceModifier: z.number().min(-100000).max(100000).default(0),
      guideId: uuid.optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { dates, totalSeats, priceModifier, guideId } = req.body;
    // unnest() inserts the whole batch in one statement.
    const { rows } = await query(
      `INSERT INTO tour_slots (tour_id, slot_date, total_seats, price_modifier, guide_id)
       SELECT $1, d::date, $3, $4, $5
         FROM unnest($2::text[]) AS d
       ON CONFLICT (tour_id, slot_date) DO UPDATE
         SET total_seats = EXCLUDED.total_seats,
             price_modifier = EXCLUDED.price_modifier,
             guide_id = EXCLUDED.guide_id
       RETURNING id, slot_date::text AS date, total_seats`,
      [req.params.tourId, dates, totalSeats, priceModifier, guideId ?? null]
    );
    res.status(201).json({ slots: rows });
  })
);

/**
 * Reducing capacity below what is already sold would silently oversell,
 * so the update refuses instead.
 */
adminRouter.patch(
  '/slots/:slotId',
  validate('params', z.object({ slotId: uuid })),
  validate(
    'body',
    z.object({
      totalSeats: z.number().int().min(1).max(500).optional(),
      isOpen: z.boolean().optional(),
      guideId: uuid.nullable().optional(),
      routeGeojson: z.record(z.unknown()).nullable().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const slot = await queryOne(
      `WITH sold AS (
         SELECT COALESCE(SUM(seat_count), 0)::int AS seats
           FROM bookings WHERE slot_id = $1 AND status = 'CONFIRMED'
       )
       UPDATE tour_slots s
          SET total_seats   = COALESCE($2, s.total_seats),
              is_open       = COALESCE($3, s.is_open),
              guide_id      = COALESCE($4, s.guide_id),
              route_geojson = COALESCE($5::jsonb, s.route_geojson)
         FROM sold
        WHERE s.id = $1
          AND COALESCE($2, s.total_seats) >= sold.seats
        RETURNING s.id, s.slot_date::text AS date, s.total_seats, s.is_open, sold.seats AS sold_seats`,
      [
        req.params.slotId,
        b.totalSeats ?? null,
        b.isOpen ?? null,
        b.guideId ?? null,
        b.routeGeojson ? JSON.stringify(b.routeGeojson) : null,
      ]
    );
    if (!slot) {
      return res.status(409).json({
        error: {
          code: 'CAPACITY_BELOW_SOLD',
          message: 'Cannot set capacity below the seats already sold for this date',
        },
      });
    }
    res.json({ slot });
  })
);

/** Map pin management. */
adminRouter.post(
  '/attractions',
  validate(
    'body',
    z.object({
      name: z.string().min(2).max(160),
      category: z.enum(['MUST_VISIT', 'MUST_EAT', 'FAMOUS_RIDE']),
      description: z.string().max(4000).default(''),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      imageUrl: z.string().url().optional(),
      city: z.string().max(80).optional(),
      scenicScore: z.number().min(0).max(1).default(0.5),
      noiseScore: z.number().min(0).max(1).default(0.5),
      crowdScore: z.number().min(0).max(1).default(0.5),
      moodTags: z.array(z.string().max(30)).max(12).default([]),
      avgVisitMin: z.number().int().min(5).max(600).default(45),
    })
  ),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const attraction = await queryOne(
      `INSERT INTO attractions (name, category, description, location, image_url, city,
                                scenic_score, noise_score, crowd_score, mood_tags, avg_visit_min)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($4,$5),4326), $6,$7,$8,$9,$10,$11::text[],$12)
       RETURNING id, name, category`,
      [
        b.name, b.category, b.description, b.lng, b.lat, b.imageUrl ?? null, b.city ?? null,
        b.scenicScore, b.noiseScore, b.crowdScore, b.moodTags, b.avgVisitMin,
      ]
    );
    res.status(201).json({ attraction });
  })
);
