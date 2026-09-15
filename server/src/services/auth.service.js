import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { query, queryOne } from '../db/pool.js';
import { env } from '../config/env.js';
import { signToken } from '../middleware/auth.js';
import { conflict, unauthorized } from '../utils/httpError.js';
import { USER_PUBLIC_SQL_BARE, toPublicUser } from '../utils/publicUser.js';

/*
 * Every function here returns `{ user, token }` with the user already mapped to
 * camelCase by toPublicUser, so no route has to know the column names.
 */

/**
 * A real bcrypt hash of a value nobody can supply, computed once at boot.
 *
 * Login compares against this when the email is unknown, so a missing account
 * and a wrong password take the same time — an attacker cannot enumerate
 * registered emails with a stopwatch. It has to be a *valid* hash: node bcrypt
 * rejects a malformed one, which would turn "unknown email" into a 500.
 */
const ABSENT_USER_HASH = bcrypt.hashSync(randomUUID(), env.BCRYPT_ROUNDS);

export async function register({ email, password, fullName, phone }) {
  // Cheap read first: hashing at 12 rounds costs ~300ms of CPU, and there is no
  // point spending it on an email that is already taken. The ON CONFLICT below
  // is what actually guarantees uniqueness — this is only a fast path.
  const taken = await queryOne('SELECT provider FROM users WHERE email = $1', [email]);
  if (taken) throw emailTakenError(taken.provider);

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  // Atomic: two simultaneous signups with the same email leave one winner and
  // one empty result, instead of one winner and one unique-violation 500.
  const row = await queryOne(
    `INSERT INTO users (email, password_hash, full_name, phone, provider, password_changed_at)
     VALUES ($1, $2, $3, $4, 'LOCAL', NOW())
     ON CONFLICT (email) DO NOTHING
     RETURNING ${USER_PUBLIC_SQL_BARE}`,
    [email, passwordHash, fullName, phone ?? null]
  );

  if (!row) {
    // Lost the race between the check and the insert.
    const existing = await queryOne('SELECT provider FROM users WHERE email = $1', [email]);
    throw emailTakenError(existing?.provider);
  }

  const user = toPublicUser(row);
  return { user, token: signToken(user) };
}

/** Google-registered addresses need a different instruction, not the same 409. */
function emailTakenError(provider) {
  return provider && provider !== 'LOCAL'
    ? conflict('That email is already registered through Google — use "Continue with Google" instead.', {
        provider,
      })
    : conflict('An account with that email already exists');
}

export async function login({ email, password }) {
  console.log("👉 0. login function called with email:", email); // Check 0
  console.log("👉 0. login function called with password:", password); // Check
  const row = await queryOne(
    `SELECT ${USER_PUBLIC_SQL_BARE}, password_hash FROM users WHERE email = $1`,
    [email]
  );

  // Always run one bcrypt comparison, whatever the outcome, so the response
  // time is the same for "no such account" and "wrong password".
  const ok = await bcrypt.compare(password, row?.password_hash ?? ABSENT_USER_HASH);

  if (!row || !ok) {
    // An OAuth-only row has no password_hash, so `ok` is already false here;
    // say so explicitly rather than letting them retype a password forever.
    if (row && row.provider !== 'LOCAL') {
      throw unauthorized('This account signs in with Google — use "Continue with Google".');
    }
    throw unauthorized('Email or password is incorrect');
  }

  // Single indexed write. Powers "last signed in" in the dashboard and is the
  // anchor for the location capture that follows the redirect.
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [row.id]);

  const user = toPublicUser(row);
  return { user, token: signToken(user) };
}

/** Google OAuth 2.0: the caller has already verified the ID token. */
export async function upsertOAuthUser({ provider, providerId, email, fullName, avatarUrl }) {
  const row = await queryOne(
    `INSERT INTO users (email, full_name, avatar_url, provider, provider_id, last_login_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (email) DO UPDATE
       SET full_name     = COALESCE(users.full_name, EXCLUDED.full_name),
           avatar_url    = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
           provider_id   = COALESCE(EXCLUDED.provider_id, users.provider_id),
           last_login_at = NOW()
     RETURNING ${USER_PUBLIC_SQL_BARE}`,
    [email, fullName, avatarUrl ?? null, provider, providerId]
  );
  const user = toPublicUser(row);
  return { user, token: signToken(user) };
}

/**
 * What /auth/google/callback calls. Thin wrapper so the route keeps reading as
 * "Google signed this person in" rather than "upsert a row with provider GOOGLE".
 */
export function googleLogin({ email, fullName, providerId, avatarUrl }) {
  return upsertOAuthUser({ provider: 'GOOGLE', providerId, email, fullName, avatarUrl });
}

/**
 * The row behind GET /auth/me. Also the session freshness check: a token minted
 * before the last password change is refused here, so a stolen token stops
 * working on the next page load rather than whenever it happens to expire.
 *
 * @param {{ id: string, tokenIssuedAt?: number }} session
 */
export async function getSession({ id, tokenIssuedAt }) {
  const row = await queryOne(
    `SELECT ${USER_PUBLIC_SQL_BARE},
            FLOOR(EXTRACT(EPOCH FROM password_changed_at)) AS pwd_changed_epoch
       FROM users WHERE id = $1`,
    [id]
  );
  if (!row) throw unauthorized('Account no longer exists');

  // `iat` has one-second granularity and is truncated down, so the token issued
  // by changePassword() can look a fraction older than the change it belongs
  // to. Two seconds of slack keeps that token valid without meaningfully
  // widening the window for a stolen one.
  const changedAt = Number(row.pwd_changed_epoch ?? 0);
  if (tokenIssuedAt && changedAt && tokenIssuedAt + 2 < changedAt) {
    throw unauthorized('Password changed, sign in again');
  }
  return toPublicUser(row);
}

/** Kept for callers that only have an id and do not need the freshness check. */
export function getProfile(userId) {
  return getSession({ id: userId });
}

export async function changePassword({ userId, currentPassword, newPassword }) {
  const row = await queryOne(
    `SELECT ${USER_PUBLIC_SQL_BARE}, password_hash FROM users WHERE id = $1`,
    [userId]
  );
  if (!row?.password_hash) throw unauthorized('Password sign-in is not enabled for this account');

  const ok = await bcrypt.compare(currentPassword, row.password_hash);
  if (!ok) throw unauthorized('Current password is incorrect');

  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await query('UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE id = $2', [
    passwordHash,
    userId,
  ]);

  // Stamping password_changed_at invalidates every existing token, including the
  // one this request arrived with. Hand back a fresh one so the caller is not
  // logged out of the tab they just changed their password in — every *other*
  // device is, which is the point.
  const user = toPublicUser(row);
  return { user, token: signToken(user), signedOutOtherDevices: true };
}
