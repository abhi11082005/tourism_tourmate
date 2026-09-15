/** Error carrying an HTTP status. Anything else becomes a 500 in the error handler. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message  Safe to show the client.
   * @param {{ code?: string, details?: unknown, cause?: unknown }} [opts]
   */
  constructor(status, message, opts = {}) {
    super(message, { cause: opts.cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = opts.code ?? httpCode(status);
    this.details = opts.details;
    this.expose = true;
  }
}

function httpCode(status) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      410: 'GONE',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMITED',
      503: 'UNAVAILABLE',
    }[status] ?? 'INTERNAL_ERROR'
  );
}

export const badRequest = (m, d) => new HttpError(400, m, { details: d });
export const unauthorized = (m = 'Sign in to continue') => new HttpError(401, m);
export const forbidden = (m = 'Not allowed') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m, d) => new HttpError(409, m, { details: d });
export const gone = (m) => new HttpError(410, m);
