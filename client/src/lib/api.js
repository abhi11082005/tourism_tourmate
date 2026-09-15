/*
 * Single place that talks to the Express API.
 *
 * - The JWT lives in memory + localStorage and travels in the Authorization
 *   header, never in a cookie, so there is no CSRF surface to defend.
 * - Errors arrive as { error: { code, message } }; they are rethrown as ApiError
 *   so components can branch on `status` (409 sold out, 410 hold expired) or on
 *   `code` where the server sets one (OSRM_TIMEOUT, LLM_NOT_CONFIGURED, ...).
 * - Every call is abortable: React Query cancels in-flight requests when the
 *   user swipes to another tour, which matters on a phone connection.
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const TOKEN_KEY = 'tourmate.token';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let token = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  // Private-mode Safari throws on localStorage. Guest browsing still works.
}

export const auth = {
  get token() {
    return token;
  },
  set(next) {
    token = next;
    try {
      next ? localStorage.setItem(TOKEN_KEY, next) : localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* keep the in-memory token; the session just won't survive a reload */
    }
  },
};

async function request(path, { method = 'GET', body, signal, query, keepalive } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method,
    signal,
    // keepalive lets a request outlive the page that started it — needed by the
    // pagehide hold-release, ignored everywhere else.
    keepalive,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const err = payload?.error ?? {};
    // A dead or revoked token should drop us back to guest mode, not loop.
    if (res.status === 401) auth.set(null);
    throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.message ?? res.statusText, err.details);
  }
  return payload;
}

/**
 * Binary GET for the ticket and invoice PDFs.
 *
 * A plain <a href> cannot be used: the JWT travels in a header, not a cookie, so
 * the browser's own navigation would arrive unauthenticated. Fetch the bytes,
 * hand them to the browser as a blob, then revoke the URL — holding onto object
 * URLs is a real memory leak on a long session.
 */
async function download(path, fallbackName) {
  const res = await fetch(new URL(`${BASE}${path}`, window.location.origin), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    // Errors are still JSON, even on a route that normally returns a PDF.
    const payload = await res.json().catch(() => null);
    if (res.status === 401) auth.set(null);
    throw new ApiError(
      res.status,
      payload?.error?.code ?? 'DOWNLOAD_FAILED',
      payload?.error?.message ?? 'That document could not be generated',
      payload?.error?.details
    );
  }

  const name =
    res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    // Safari needs the URL to outlive the click by a tick.
    setTimeout(() => URL.revokeObjectURL(url), 4_000);
  }
  return name;
}

export const api = {
  // ---------------------------------------------------------------- auth
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  me: (signal) => request('/auth/me', { signal }),
  changePassword: (body) => request('/auth/change-password', { method: 'POST', body }),

  // ------------------------------------------------------- account (me)
  profile: (signal) => request('/users/me', { signal }),
  updateProfile: (body) => request('/users/me', { method: 'PATCH', body }),
  setLocation: (body) => request('/users/me/location', { method: 'PUT', body }),
  updatePreferences: (body) => request('/users/me/preferences', { method: 'PATCH', body }),
  summary: (signal) => request('/users/me/summary', { signal }),
  activity: (query, signal) => request('/users/me/activity', { query, signal }),
  payments: (query, signal) => request('/users/me/payments', { query, signal }),

  // ------------------------------------------------------ help & support
  tickets: (signal) => request('/support/tickets', { signal }),
  ticket: (id, signal) => request(`/support/tickets/${id}`, { signal }),
  createTicket: (body) => request('/support/tickets', { method: 'POST', body }),
  replyToTicket: (id, body) =>
    request(`/support/tickets/${id}/messages`, { method: 'POST', body }),
  supportInbox: (query, signal) => request('/support/tickets/inbox', { query, signal }),
  setTicketStatus: (id, body) =>
    request(`/support/tickets/${id}/status`, { method: 'PATCH', body }),

  // --------------------------------------------------------------- tours
  listTours: (query, signal) => request('/tours', { query, signal }),
  suggestTours: (q, signal) => request('/tours/suggest', { query: { q }, signal }),
  getTour: (slug, signal) => request(`/tours/${slug}`, { signal }),

  // -------------------------------------------------------- offers (public)
  // Festival campaigns drive the homepage banner and the strike-through prices
  // on tour cards. Public on purpose: a guest should see live offers before the
  // login wall, exactly like the rest of guest mode.
  activeCampaigns: (signal) => request('/campaigns/active', { signal }),

  // --------------------------------------------------- attractions / map
  // `radius` is in metres — the server validates 100..50_000.
  nearby: ({ lat, lng, radius, category, moods, limit }, signal) =>
    request('/attractions/nearby', {
      query: { lat, lng, radius, category, moods: moods?.join(','), limit },
      signal,
    }),
  byCategory: (category, signal) => request(`/attractions/category/${category}`, { signal }),
  pins: (bounds, signal) => request('/attractions/pins', { query: bounds, signal }),

  // ------------------------------------------------------------ booking
  calendar: (tourId, { from, to }, signal) =>
    request(`/bookings/calendar/${tourId}`, { query: { from, to }, signal }),
  availability: (slotId, signal) => request(`/bookings/availability/${slotId}`, { signal }),
  quote: (body, signal) => request('/bookings/quote', { method: 'POST', body, signal }),
  /*
   * Price a coupon *before* the hold. This is deliberately its own call and not a
   * field on quote: the booking rail shows the discounted total while the guest is
   * still deciding, and only folds `couponCode` into checkout once they commit. The
   * server stays the single source of truth for money — the client never subtracts.
   * Body: { tourId, slotId, seatCount, selectedOptions, code }.
   */
  validateCoupon: (body, signal) =>
    request('/bookings/validate-coupon', { method: 'POST', body, signal }),
  checkout: (body) => request('/bookings/checkout', { method: 'POST', body }),
  bookingState: (id, signal) => request(`/bookings/${id}/state`, { signal }),
  extendHold: (id) => request(`/bookings/${id}/extend`, { method: 'POST' }),
  abandon: (id) => request(`/bookings/${id}/abandon`, { method: 'POST' }),
  /*
   * Release the hold from a pagehide handler.
   *
   * Not navigator.sendBeacon: a beacon cannot carry headers, and our JWT lives in
   * Authorization (never a cookie), so every beacon was silently 401'd and the
   * seats sat held until the Redis TTL lapsed. fetch with keepalive survives the
   * unload *and* sends the header. Errors are swallowed — the page is going away.
   */
  abandonBeacon: (id) =>
    request(`/bookings/${id}/abandon`, { method: 'POST', keepalive: true }).catch(() => {}),
  // Creates (or re-uses) the Razorpay order. Returns the publishable key id and
  // the amount in paise, both decided server-side — the browser never sets a price.
  createOrder: (id) => request(`/bookings/${id}/order`, { method: 'POST' }),
  paymentFailed: (id, body) => request(`/bookings/${id}/payment-failed`, { method: 'POST', body }),
  confirm: (id, body) => request(`/bookings/${id}/confirm`, { method: 'POST', body }),
  cancel: (id) => request(`/bookings/${id}/cancel`, { method: 'POST' }),
  myBookings: (signal) => request('/bookings/mine', { signal }),
  ticketPdf: (id, reference) => download(`/bookings/${id}/ticket.pdf`, `ticket-${reference}.pdf`),
  invoicePdf: (id, reference) => download(`/bookings/${id}/invoice.pdf`, `invoice-${reference}.pdf`),

  // ------------------------------------------------------------- social
  reviews: (tourId, query, signal) => request(`/social/tours/${tourId}/reviews`, { query, signal }),
  createReview: (tourId, body) =>
    request(`/social/tours/${tourId}/reviews`, { method: 'POST', body }),
  comments: (reviewId, signal) => request(`/social/reviews/${reviewId}/comments`, { signal }),
  addComment: (reviewId, body) =>
    request(`/social/reviews/${reviewId}/comments`, { method: 'POST', body }),
  deleteComment: (id) => request(`/social/comments/${id}`, { method: 'DELETE' }),
  likeReview: (id) => request(`/social/reviews/${id}/like`, { method: 'POST' }),
  likeComment: (id) => request(`/social/comments/${id}/like`, { method: 'POST' }),
  wishlist: (signal) => request('/social/wishlist', { signal }),
  toggleWishlist: (tourId) => request(`/social/wishlist/${tourId}`, { method: 'POST' }), 

  // ------------------------------------------------------------ routing
  route: (body, signal) => request('/routing/route', { method: 'POST', body, signal }),
  guidedRoute: (slotId, signal) => request(`/routing/guided/${slotId}`, { signal }),

  // -------------------------------------------------------------- admin
  analytics: (signal) => request('/admin/analytics', { signal }),
  createTourAdmin: (body) => request('/admin/tours', { method: 'POST', body }),
  // The wizard reuses the same shape for create and edit; only the verb differs.
  updateTourAdmin: (tourId, body) => request(`/admin/tours/${tourId}`, { method: 'PATCH', body }),
  createSlots: (tourId, body) => request(`/admin/tours/${tourId}/slots`, { method: 'POST', body }),
  updateSlot: (slotId, body) => request(`/admin/slots/${slotId}`, { method: 'PATCH', body }),
  createAttraction: (body) => request('/admin/attractions', { method: 'POST', body }),

  // Guide roster for the assignment dropdown, and the departures that still need
  // one. `updateSlot({ guideId })` (above) is what actually pins a guide to a date.
  guides: (signal) => request('/admin/guides', { signal }),
  upcomingDepartures: (query, signal) => request('/admin/departures', { query, signal }),

  // Discount engine. Coupons are code-entered at checkout; campaigns auto-apply and
  // drive the homepage banner + strike-through cards. Toggles flip active without
  // a destructive delete, so a festival can be re-run next year.
  listCoupons: (signal) => request('/admin/coupons', { signal }),
  createCoupon: (body) => request('/admin/coupons', { method: 'POST', body }),
  setCouponActive: (id, isActive) =>
    request(`/admin/coupons/${id}`, { method: 'PATCH', body: { isActive } }),
  listCampaigns: (signal) => request('/admin/campaigns', { signal }),
  createCampaign: (body) => request('/admin/campaigns', { method: 'POST', body }),
  setCampaignActive: (id, isActive) =>
    request(`/admin/campaigns/${id}`, { method: 'PATCH', body: { isActive } }),
};

/**
 * "Ask the Expert" — consumes the SSE stream token by token.
 * Reading the stream by hand (rather than EventSource) is what lets us send a
 * POST body and an Authorization header, and abort mid-answer.
 *
 * @param {{tourId: string, question: string}} payload
 * @param {{onSources?: Function, onToken: Function, signal?: AbortSignal}} handlers
 */
export async function askExpert({ tourId, question }, { onSources, onToken, signal } = {}) {
  const res = await fetch(`${BASE}/assistant/ask`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ tourId, question }),
  });

  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      payload?.error?.code ?? 'ASSISTANT_UNAVAILABLE',
      payload?.error?.message ?? 'The assistant is unavailable right now'
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = frame.match(/^data:\s*(.+)$/m)?.[1];
      if (!data) continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === 'sources') onSources?.(parsed);
      else if (event === 'token') onToken(parsed.token);
      else if (event === 'error') throw new ApiError(502, 'ASSISTANT_STREAM', parsed.message);
      else if (event === 'done') return;
    }
  }
}
