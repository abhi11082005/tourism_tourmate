import { query, queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';

/**
 * Package cards. Guest-visible. Ratings are aggregated in SQL so the list is
 * one round trip regardless of page size.
 */
export async function listTours({
  q,
  tourType,
  minPrice,
  maxPrice,
  maxDays,
  limit = 12,
  offset = 0,
  sort = 'popular',
}) {
  const order =
    {
      popular: 'review_count DESC NULLS LAST, avg_rating DESC NULLS LAST',
      price_asc: 't.base_price ASC',
      price_desc: 't.base_price DESC',
      newest: 't.created_at DESC',
    }[sort] ?? 'review_count DESC NULLS LAST';

  const { rows } = await query(
    `SELECT t.id,
            t.title,
            t.slug,
            t.tour_type,
            t.base_price,
            t.duration_days,
            t.duration_nights,
            LEFT(t.overview, 180)                       AS teaser,
            t.gallery -> 0 -> 'url'                     AS cover_url,
            ROUND(AVG(r.rating)::numeric, 1)            AS avg_rating,
            COUNT(r.id)::int                            AS review_count,
            -- cheapest and dearest per-seat total, straight out of JSONB
            t.base_price + COALESCE((
              SELECT SUM(GREATEST((opt.value ->> 'pricePerSeat')::numeric, 0))
                FROM jsonb_each(t.options) opt
               WHERE opt.value ->> 'type' = 'boolean'
            ), 0)                                       AS max_price
       FROM tours t
       LEFT JOIN reviews r ON r.tour_id = t.id
      WHERE t.is_published
        AND ($1::text IS NULL OR t.title ILIKE '%' || $1 || '%' OR t.overview ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR t.tour_type = $2)
        AND ($3::numeric IS NULL OR t.base_price >= $3)
        AND ($4::numeric IS NULL OR t.base_price <= $4)
        AND ($5::int IS NULL OR t.duration_days <= $5)
      GROUP BY t.id
      ORDER BY ${order}
      LIMIT $6 OFFSET $7`,
    [q ?? null, tourType ?? null, minPrice ?? null, maxPrice ?? null, maxDays ?? null, limit, offset]
  );

  const total = await queryOne(
    `SELECT COUNT(*)::int AS count FROM tours t
      WHERE t.is_published
        AND ($1::text IS NULL OR t.title ILIKE '%' || $1 || '%' OR t.overview ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR t.tour_type = $2)`,
    [q ?? null, tourType ?? null]
  );

  return { items: rows, total: total.count, limit, offset };
}

/**
 * Detailed package view: JSONB blocks plus its attractions as GeoJSON so the
 * map can render pins without a second request.
 */
export async function getTourBySlug(slug) {
  const tour = await queryOne(
    `SELECT t.id, t.title, t.slug, t.overview, t.tour_type,
            t.base_price, t.total_seats, t.duration_days, t.duration_nights,
            t.itinerary, t.inclusions, t.exclusions, t.options, t.gallery, t.refund_policy,
            ST_AsGeoJSON(t.start_point)::json           AS start_point,
            ROUND(AVG(r.rating)::numeric, 1)            AS avg_rating,
            COUNT(r.id)::int                            AS review_count,
            COALESCE(
              (SELECT json_agg(a ORDER BY a.visit_order)
                 FROM (
                   SELECT ta.visit_order,
                          att.id, att.name, att.category, att.description,
                          att.image_url, att.avg_visit_min, att.mood_tags,
                          ST_Y(att.location) AS lat,
                          ST_X(att.location) AS lng
                     FROM tour_attractions ta
                     JOIN attractions att ON att.id = ta.attraction_id
                    WHERE ta.tour_id = t.id
                 ) a), '[]'::json
            )                                           AS attractions
       FROM tours t
       LEFT JOIN reviews r ON r.tour_id = t.id
      WHERE t.slug = $1 AND t.is_published
      GROUP BY t.id`,
    [slug]
  );
  if (!tour) throw notFound('Tour not found');
  return tour;
}

/** Rating histogram for the reviews panel — 5 counts in one pass. */
export async function getRatingBreakdown(tourId) {
  const row = await queryOne(
    `SELECT COUNT(*) FILTER (WHERE rating = 5)::int AS five,
            COUNT(*) FILTER (WHERE rating = 4)::int AS four,
            COUNT(*) FILTER (WHERE rating = 3)::int AS three,
            COUNT(*) FILTER (WHERE rating = 2)::int AS two,
            COUNT(*) FILTER (WHERE rating = 1)::int AS one,
            ROUND(AVG(rating)::numeric, 2)         AS average
       FROM reviews WHERE tour_id = $1`,
    [tourId]
  );
  return row;
}

/** Fuzzy title search for the search box (pg_trgm). */
export async function suggestTours(term, limit = 6) {
  const { rows } = await query(
    `SELECT id, title, slug, similarity(title, $1) AS score
       FROM tours
      WHERE is_published AND title % $1
      ORDER BY score DESC
      LIMIT $2`,
    [term, limit]
  );
  return rows;
}
