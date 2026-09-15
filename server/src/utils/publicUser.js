/*
 * One definition of "a user, as the browser sees it".
 *
 * Postgres speaks snake_case and stores locations as PostGIS geometries; React
 * wants camelCase and plain numbers. Doing that translation in one place is what
 * stops bugs like Layout.jsx reading `user.fullName` while the API returns
 * `full_name` — which is exactly the bug this file was written to kill.
 *
 * The SQL select list lives next to the mapper on purpose: change one and the
 * other is right there.
 */

/** Column list for every endpoint that returns a user. Never includes password_hash. */
export const USER_PUBLIC_SQL = `
  u.id, u.email, u.full_name, u.phone, u.role, u.avatar_url, u.provider,
  u.home_city, u.home_country,
  ST_Y(u.home_location) AS home_lat, ST_X(u.home_location) AS home_lng,
  ST_Y(u.last_location) AS last_lat, ST_X(u.last_location) AS last_lng,
  u.last_location_at, u.location_source, u.preferences,
  u.created_at, u.last_login_at`;

/** Same list without the `u.` alias, for single-table queries. */
export const USER_PUBLIC_SQL_BARE = USER_PUBLIC_SQL.replace(/\bu\./g, '');

/**
 * Defaults for every preference the UI reads. Merged server-side so the client
 * never has to guard against `undefined` — an empty `{}` from a freshly
 * registered account comes back fully populated.
 */
export const PREFERENCE_DEFAULTS = Object.freeze({
  theme: 'system', // 'light' | 'dark' | 'system'
  locale: 'en-IN',
  currency: 'INR',
  distanceUnit: 'km',
  moods: [],
  notifications: Object.freeze({ email: true, whatsapp: false, promotions: false }),
});

/** Shallow merge, one level deep for `notifications`. */
export function withPreferenceDefaults(stored) {
  const p = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return {
    ...PREFERENCE_DEFAULTS,
    ...p,
    notifications: { ...PREFERENCE_DEFAULTS.notifications, ...(p.notifications ?? {}) },
  };
}

/**
 * @param {Record<string, any> | null} row A row selected with USER_PUBLIC_SQL.
 * @returns {object | null}
 */
export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone ?? null,
    role: row.role,
    avatarUrl: row.avatar_url ?? null,
    provider: row.provider,
    // Stable profile field the traveller edits.
    home: {
      city: row.home_city ?? null,
      country: row.home_country ?? null,
      lat: row.home_lat ?? null,
      lng: row.home_lng ?? null,
    },
    // Volatile browser reading, captured at login. Null until permission is
    // granted once, and never used to overwrite `home`.
    lastLocation:
      row.last_lat == null
        ? null
        : {
            lat: row.last_lat,
            lng: row.last_lng,
            at: row.last_location_at,
            source: row.location_source,
          },
    preferences: withPreferenceDefaults(row.preferences),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}
