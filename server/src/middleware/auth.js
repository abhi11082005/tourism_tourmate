import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized, forbidden } from '../utils/httpError.js';
import { queryOne } from '../db/pool.js';

/** @param {{ id: string, role: string, email: string }} user */
export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'tour-mate',
  });
}

function readBearer(req) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/*
 * `iat` is carried through on req.user as tokenIssuedAt. Password changes stamp
 * users.password_changed_at, and anything that already reads the user row
 * (GET /auth/me, assertLiveRole) refuses a token minted before it. That gives
 * "sign out my other devices" without a server-side session table, at the cost
 * of not being instant on endpoints that never touch the users table.
 */
const sessionFrom = (payload) => ({
  id: payload.sub,
  role: payload.role,
  email: payload.email,
  tokenIssuedAt: payload.iat,
});

/**
 * Guest mode: attaches req.user when a valid token is present, but never blocks.
 * Browsing tours, attractions and reviews uses this.
 */
export function optionalAuth(req, _res, next) {
  const token = readBearer(req);
  if (!token) return next();
  try {
    req.user = sessionFrom(jwt.verify(token, env.JWT_SECRET, { issuer: 'tour-mate' }));
  } catch {
    // A bad token in guest mode is simply "not signed in".
  }
  next();
}

/** Hard gate. Everything past the checkout boundary uses this. */
export function requireAuth(req, _res, next) {
  const token = readBearer(req);
  if (!token) return next(unauthorized());
  try {
    req.user = sessionFrom(jwt.verify(token, env.JWT_SECRET, { issuer: 'tour-mate' }));
    return next();
  } catch (err) {
    const expired = err?.name === 'TokenExpiredError';
    return next(unauthorized(expired ? 'Session expired, sign in again' : 'Invalid session'));
  }
}

/** @param {...('USER'|'GUIDE'|'ADMIN')} roles */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/**
 * Roles live in the token for speed, but privileged writes re-read the row so a
 * demoted admin cannot keep acting on an old token until it expires. The same
 * read answers "was this token issued before the last password change?", so
 * revoking a session costs nothing extra here.
 */
export async function assertLiveRole(req, _res, next) {
  try {
    const row = await queryOne(
      `SELECT role, FLOOR(EXTRACT(EPOCH FROM password_changed_at)) AS pwd_changed_epoch
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!row) return next(unauthorized('Account no longer exists'));
    if (row.role !== req.user.role) return next(forbidden('Permissions changed, sign in again'));
    // Two seconds of slack: `iat` is whole seconds, truncated down, so the token
    // handed back by changePassword() must not invalidate itself.
    const changedAt = Number(row.pwd_changed_epoch ?? 0);
    if (req.user.tokenIssuedAt && changedAt && req.user.tokenIssuedAt + 2 < changedAt) {
      return next(unauthorized('Password changed, sign in again'));
    }
    next();
  } catch (err) {
    next(err);
  }
}
