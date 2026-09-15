import { query, queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';
import { USER_PUBLIC_SQL_BARE, toPublicUser } from '../utils/publicUser.js';

/*
 * Everything behind the dashboard's Profile, Location, Preferences, Reviews and
 * Payments modules. Raw SQL over node-postgres; the only clever parts are noted
 * where they are.
 *
 * PostGIS note that costs people an afternoon: ST_MakePoint takes (x, y), and x
 * is LONGITUDE. Latitude second, every time.
 */

const point = (lng, lat) => [lng, lat];

export async function getUser(userId) {
  const row = await queryOne(`SELECT ${USER_PUBLIC_SQL_BARE} FROM users WHERE id = $1`, [userId]);
  if (!row) throw notFound('Account not found');
  return toPublicUser(row);
}

/**
 * Whitelist of patchable profile columns. The keys are what the client sends,
 * the values are column names — so the SET list is assembled from constants
 * here, never from request data, and the values still travel as $n parameters.
 */
const PROFILE_COLUMNS = {
  fullName: 'full_name',
  phone: 'phone',
  avatarUrl: 'avatar_url',
  homeCity: 'home_city',
  homeCountry: 'home_country',
};

/** PATCH /users/me — partial update; absent keys are left alone. */
export async function updateProfile(userId, patch) {
  const sets = [];
  const params = [userId];

  for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
    if (patch[key] === undefined) continue;
    // An emptied optional field means "clear it", not "store an empty string",
    // so `phone: ''` becomes NULL and stays out of contact lists.
    params.push(patch[key] === '' ? null : patch[key]);
    sets.push(`${column} = $${params.length}`);
  }

  if (sets.length === 0) return getUser(userId);

  const row = await queryOne(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_PUBLIC_SQL_BARE}`,
    params
  );
  if (!row) throw notFound('Account not found');
  return toPublicUser(row);
}

/**
 * PUT /users/me/location — the browser reading captured just after login, or a
 * manually typed city when permission was denied.
 *
 * Writes `last_location` always and `home_location` only when asked. A traveller
 * checking the app from an airport must not have their home city rewritten.
 *
 * $5 carries an explicit ::boolean cast because node-postgres sends every
 * parameter as an untyped string: in `CASE WHEN $5 THEN` Postgres has nothing to
 * infer from and raises "argument of CASE/WHEN must be type boolean".
 */
export async function updateLocation(userId, { lat, lng, source, city, country, setAsHome }) {
  const row = await queryOne(
    `UPDATE users
        SET last_location    = ST_SetSRID(ST_MakePoint($2, $3), 4326),
            last_location_at = NOW(),
            location_source  = $4::geo_source,
            home_location    = CASE WHEN $5::boolean
                                    THEN ST_SetSRID(ST_MakePoint($2, $3), 4326)
                                    ELSE home_location END,
            home_city        = CASE WHEN $5::boolean THEN COALESCE($6, home_city) ELSE home_city END,
            home_country     = CASE WHEN $5::boolean THEN COALESCE($7, home_country) ELSE home_country END
      WHERE id = $1
      RETURNING ${USER_PUBLIC_SQL_BARE}`,
    [userId, ...point(lng, lat), source, Boolean(setAsHome), city ?? null, country ?? null]
  );
  if (!row) throw notFound('Account not found');
  return toPublicUser(row);
}

/**
 * PATCH /users/me/preferences — merged in Postgres rather than read-modify-write
 * in Node, so two tabs toggling different settings cannot clobber each other.
 * `||` is a shallow merge, so `notifications` gets its own explicit merge.
 */
export async function updatePreferences(userId, { notifications, ...flat }) {
  const row = await queryOne(
    `UPDATE users
        SET preferences = (COALESCE(preferences, '{}'::jsonb) || $2::jsonb)
                          || jsonb_build_object(
                               'notifications',
                               COALESCE(preferences -> 'notifications', '{}'::jsonb) || $3::jsonb)
      WHERE id = $1
      RETURNING ${USER_PUBLIC_SQL_BARE}`,
    [userId, JSON.stringify(flat), JSON.stringify(notifications ?? {})]
  );
  if (!row) throw notFound('Account not found');
  return toPublicUser(row);
}

/**
 * Header counters for the dashboard. One round trip of scalar subqueries: nine
 * separate endpoints would each pay the connection and auth cost, and the
 * numbers would be from nine slightly different moments.
 *
 * COUNT() is BIGINT, which node-postgres hands back as a string to avoid
 * precision loss — hence the Number() pass. Money stays a string all the way to
 * the client, exactly as the pool's NUMERIC parser intends.
 */
export async function summary(userId) {
  const row = await queryOne(
    `SELECT
       (SELECT COUNT(*) FROM bookings
          WHERE user_id = $1 AND status = 'CONFIRMED' AND booking_date >= CURRENT_DATE)
         AS upcoming_trips,
       (SELECT COUNT(*) FROM bookings
          WHERE user_id = $1 AND status = 'CONFIRMED' AND booking_date < CURRENT_DATE)
         AS past_trips,
       (SELECT COUNT(*) FROM bookings
          WHERE user_id = $1 AND status = 'PENDING' AND expires_at > NOW())
         AS live_holds,
       (SELECT COALESCE(SUM(total_amount), 0) FROM bookings
          WHERE user_id = $1 AND status = 'CONFIRMED')
         AS lifetime_spend,
       (SELECT COALESCE(SUM(p.refund_amount), 0) FROM payments p
           JOIN bookings b ON b.id = p.booking_id
          WHERE b.user_id = $1 AND p.refund_amount IS NOT NULL)
         AS refunded_total,
       (SELECT COUNT(*) FROM wishlists WHERE user_id = $1)               AS saved_count,
       (SELECT COUNT(*) FROM reviews   WHERE user_id = $1)               AS review_count,
       (SELECT COUNT(*) FROM comments  WHERE user_id = $1 AND NOT is_deleted) AS comment_count,
       (SELECT COUNT(*) FROM support_tickets
          WHERE user_id = $1 AND status IN ('OPEN', 'AWAITING_CUSTOMER')) AS open_tickets`,
    [userId]
  );

  return {
    upcomingTrips: Number(row.upcoming_trips),
    pastTrips: Number(row.past_trips),
    liveHolds: Number(row.live_holds),
    lifetimeSpend: row.lifetime_spend,
    refundedTotal: row.refunded_total,
    savedCount: Number(row.saved_count),
    reviewCount: Number(row.review_count),
    commentCount: Number(row.comment_count),
    openTickets: Number(row.open_tickets),
  };
}

/**
 * "Everything I have written" — reviews and comments in one chronological log,
 * which is how the user asked for it and how they remember it.
 *
 * UNION ALL rather than two requests: the client would otherwise have to merge
 * and sort two lists, and paginating a client-side merge is a trap.
 */
export async function activityLog(userId, { limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT 'REVIEW' AS kind, r.id, r.created_at, r.rating, r.content, r.like_count,
            t.title AS tour_title, t.slug AS tour_slug, NULL::uuid AS review_id
       FROM reviews r
       JOIN tours t ON t.id = r.tour_id
      WHERE r.user_id = $1
     UNION ALL
     SELECT 'COMMENT', c.id, c.created_at, NULL::smallint, c.content, c.like_count,
            t.title, t.slug, c.review_id
       FROM comments c
       JOIN reviews r ON r.id = c.review_id
       JOIN tours   t ON t.id = r.tour_id
      WHERE c.user_id = $1 AND NOT c.is_deleted
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    createdAt: r.created_at,
    rating: r.rating,
    content: r.content,
    likeCount: r.like_count,
    tourTitle: r.tour_title,
    tourSlug: r.tour_slug,
    reviewId: r.review_id,
  }));
}

/**
 * Payment and refund tracking. One row per gateway attempt, newest first, joined
 * to the booking it paid for so the UI can label it without a second call.
 */
export async function paymentHistory(userId, { limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT p.id, p.status, p.amount, p.currency, p.gateway, p.gateway_payment_id,
            p.refund_amount, p.refunded_at, p.refund_reference, p.failure_reason,
            p.signature_verified, p.created_at, p.updated_at,
            b.id AS booking_id, b.reference, b.status AS booking_status,
            b.booking_date::text AS booking_date, b.seat_count,
            t.title AS tour_title, t.slug AS tour_slug
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN tours    t ON t.id = b.tour_id
      WHERE b.user_id = $1
      ORDER BY p.created_at DESC
      LIMIT $2`,
    [userId, limit]
  );

  return rows.map((p) => ({
    id: p.id,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    gateway: p.gateway,
    gatewayPaymentId: p.gateway_payment_id,
    signatureVerified: p.signature_verified,
    refund:
      p.refund_amount == null
        ? null
        : { amount: p.refund_amount, at: p.refunded_at, reference: p.refund_reference },
    failureReason: p.failure_reason,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    booking: {
      id: p.booking_id,
      reference: p.reference,
      status: p.booking_status,
      date: p.booking_date,
      seatCount: p.seat_count,
      tourTitle: p.tour_title,
      tourSlug: p.tour_slug,
    },
  }));
}
