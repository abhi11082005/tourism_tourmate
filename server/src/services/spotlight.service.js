// backend/src/services/spotlight.service.js
import { queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';

/**
 * Get exact details for a specific spotlight.
 * Calculates dynamic distance in kilometers if user coordinates are provided.
 */
export async function getSpotlightDetails({ id, userLat, userLng }) {
  let row;

  if (userLat != null && userLng != null) {
    // If user location is provided, calculate distance using PostGIS ST_DistanceSphere
    row = await queryOne(
      `SELECT id, title, city, image_url, description, category,
              ST_X(coordinates::geometry) AS lng,
              ST_Y(coordinates::geometry) AS lat,
              ROUND((ST_DistanceSphere(coordinates, ST_MakePoint($1, $2)) / 1000)::numeric, 1) AS distance_km
         FROM spotlights 
        WHERE id = $3`,
      [userLng, userLat, id] // Note: ST_MakePoint takes (Longitude, Latitude)
    );
  } else {
    // Fallback if user denies location permission (Guest Mode / No Location)
    row = await queryOne(
      `SELECT id, title, city, image_url, description, category,
              ST_X(coordinates::geometry) AS lng,
              ST_Y(coordinates::geometry) AS lat
         FROM spotlights 
        WHERE id = $1`,
      [id]
    );
  }

  if (!row) {
    throw notFound('Spotlight not found');
  }

  return row;
}