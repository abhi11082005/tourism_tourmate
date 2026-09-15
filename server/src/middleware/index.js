import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';
import { isProd } from '../config/env.js';

/** Wrap async handlers so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Validate and replace part of the request. Keeps handlers free of guard code.
 * @param {'body'|'query'|'params'} source
 * @param {import('zod').ZodTypeAny} schema
 */
export const validate = (source, schema) => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return next(
      new HttpError(422, 'Request validation failed', {
        code: 'VALIDATION_ERROR',
        details: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      })
    );
  }
  req[source] = result.data;
  next();
};

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, `No route for ${req.method} ${req.originalUrl}`));
}

// Postgres error codes we can translate into something a user can act on.
const PG_MESSAGES = {
  '23505': [409, 'That record already exists'],
  '23503': [409, 'Referenced record does not exist'],
  '23514': [422, 'A value is outside the allowed range'],
  '57014': [503, 'The database took too long, please retry'],
  '40001': [409, 'Busy right now, please retry'], // serialization failure
};

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let body = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 422;
    body = { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' } };
  } else if (err?.code && PG_MESSAGES[err.code]) {
    const [pgStatus, message] = PG_MESSAGES[err.code];
    status = pgStatus;
    body = { error: { code: `PG_${err.code}`, message } };
  }

  const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log({ err, status, path: req.originalUrl, userId: req.user?.id }, 'request failed');

  if (!isProd && status >= 500) body.error.stack = err?.stack;
  res.status(status).json(body);
}
