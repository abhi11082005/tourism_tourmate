import { query, queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';

/**
 * "Near Me" — attractions within `radiusMeters` of the user's live position.
 *
 * ST_DWithin on the geography cast gives metre units and uses
 * attractions_location_geog_gist. Distance is computed once in the projection and
 * reused for ordering, so the planner does not evaluate ST_Distance twice.
 */
export async function findNearby({
  lat,
  lng,
  radiusMeters = 5000,
  category,
  moods,
  limit = 50,
}) {
  const { rows } = await query(
    `SELECT a.id,
            a.name,
            a.category,
            a.description,
            a.image_url,
            a.city,
            a.mood_tags,
            a.avg_visit_min,
            a.scenic_score,
            a.noise_score,
            a.crowd_score,
            ST_Y(a.location)                            AS lat,
            ST_X(a.location)                            AS lng,
            ROUND(ST_Distance(a.location::geography, origin.geog))::int AS distance_m
       FROM attractions a
       CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS geog) origin
      WHERE ST_DWithin(a.location::geography, origin.geog, $3)
        AND ($4::attraction_category IS NULL OR a.category = $4)
        AND ($5::text[] IS NULL OR a.mood_tags && $5)
      ORDER BY distance_m
      LIMIT $6`,
    [lat, lng, radiusMeters, category ?? null, moods?.length ? moods : null, limit]
  );
  return rows;
}

/** Curated spotlights: "Must Visit" / "Must Eat" / "Famous Rides" rails. */
export async function listByCategory({ category, city, limit = 20, offset = 0 }) {
  const { rows } = await query(
    `SELECT id, name, category, description, image_url, city, mood_tags, avg_visit_min,
            ST_Y(location) AS lat, ST_X(location) AS lng
       FROM attractions
      WHERE category = $1
        AND ($2::text IS NULL OR city = $2)
      ORDER BY scenic_score DESC, name
      LIMIT $3 OFFSET $4`,
    [category, city ?? null, limit, offset]
  );
  return rows;
}

/** All pins inside the current map viewport, as a GeoJSON FeatureCollection. */
export async function pinsInBounds({ west, south, east, north, category }) {
  const row = await queryOne(
    `SELECT json_build_object(
              'type', 'FeatureCollection',
              'features', COALESCE(json_agg(
                json_build_object(
                  'type', 'Feature',
                  'geometry', ST_AsGeoJSON(a.location)::json,
                  'properties', json_build_object(
                    'id', a.id, 'name', a.name, 'category', a.category,
                    'imageUrl', a.image_url, 'visitMinutes', a.avg_visit_min,
                    'scenic', a.scenic_score, 'quiet', 1 - a.noise_score
                  )
                )
              ), '[]'::json)
            ) AS geojson
       FROM attractions a
      WHERE a.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        AND ($5::attraction_category IS NULL OR a.category = $5)`,
    [west, south, east, north, category ?? null]
  );
  return row.geojson;
}

export async function getAttraction(id) {
  const row = await queryOne(
    `SELECT a.id, a.name, a.category, a.description, a.image_url, a.city,
            a.mood_tags, a.avg_visit_min, a.scenic_score, a.noise_score, a.crowd_score,
            ST_Y(a.location) AS lat, ST_X(a.location) AS lng,
            COALESCE((
              SELECT json_agg(json_build_object('id', t.id, 'title', t.title, 'slug', t.slug))
                FROM tour_attractions ta
                JOIN tours t ON t.id = ta.tour_id AND t.is_published
               WHERE ta.attraction_id = a.id
            ), '[]'::json) AS tours
       FROM attractions a
      WHERE a.id = $1`,
    [id]
  );
  if (!row) throw notFound('Attraction not found');
  return row;
}

/**
 * Candidate waypoints between two points for mood-based routing: everything in
 * the corridor around the straight line, scored by the requested mood.
 *
 * Weights are applied in SQL so only the top few rows cross the wire into OSRM.
 */
export async function corridorCandidates({ from, to, mood = 'scenic', corridorMeters = 1200, limit = 8 }) {
  const weights = {
    scenic: { scenic: 1.0, quiet: 0.2, uncrowded: 0.1 },
    quiet: { scenic: 0.2, quiet: 1.0, uncrowded: 0.6 },
    fastest: { scenic: 0.0, quiet: 0.0, uncrowded: 0.0 },
    food: { scenic: 0.3, quiet: 0.1, uncrowded: 0.1 },
  }[mood] ?? { scenic: 1.0, quiet: 0.2, uncrowded: 0.1 };

  const { rows } = await query(
    `WITH line AS (
       SELECT ST_MakeLine(
                ST_SetSRID(ST_MakePoint($1, $2), 4326),
                ST_SetSRID(ST_MakePoint($3, $4), 4326)
              )::geography AS geog
     )
     SELECT a.id, a.name, a.category, a.avg_visit_min,
            ST_Y(a.location) AS lat, ST_X(a.location) AS lng,
            ROUND((
              $6::real * a.scenic_score
            + $7::real * (1 - a.noise_score)
            + $8::real * (1 - a.crowd_score)
            )::numeric, 3) AS mood_score,
            ROUND(ST_Distance(a.location::geography, line.geog))::int AS detour_m
       FROM attractions a, line
      WHERE ST_DWithin(a.location::geography, line.geog, $5)
        AND ($9::text = 'food' OR a.category <> 'MUST_EAT')
      ORDER BY mood_score DESC, detour_m ASC
      LIMIT $10`,
    [
      from.lng, from.lat, to.lng, to.lat,
      corridorMeters,
      weights.scenic, weights.quiet, weights.uncrowded,
      mood, limit,
    ]
  );
  return rows;
}
