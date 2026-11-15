/*
 * Shared campaign helpers: the one place discount arithmetic, campaign state and
 * date-input conversion live, so the banner, the cards, the tour page and the admin
 * preview can never disagree with each other (or with the server).
 *
 * Money rule: the server prices a campaign as
 *     discount = Math.floor(baseTotal * discount_percent / 100)
 * (see startCheckout in booking.service.js). computeDeal mirrors that exactly, so a
 * price shown on a card is the price the server will actually charge for the base seat.
 */

export const DEALS_ANCHOR = 'deals';

/** setTimeout stores its delay in a signed 32-bit int; anything larger fires immediately. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const DAY_MS = 86_400_000;

/**
 * Original price + percent → what the traveller pays and saves, or null when there
 * is nothing honest to show (bad price, bad percent, or a saving that rounds to 0).
 */
export function computeDeal(price, percent) {
  const original = Number(price);
  const pct = Number(percent);
  if (!Number.isFinite(original) || original <= 0) return null;
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  const saved = Math.floor((original * pct) / 100);
  if (saved <= 0) return null;
  return { original, saved, discounted: original - saved, percent: pct };
}

const time = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * 'live' | 'scheduled' | 'paused' | 'ended'.
 *
 * Ended wins over everything (nothing left to do with it), then paused (the master
 * switch), then the start fence. A bare array from an older server may omit isActive;
 * that is treated as active, same as the original hook did.
 */
export function campaignState(c, now = Date.now()) {
  const start = time(c.startsAt);
  const end = time(c.endsAt);
  if (end != null && end <= now) return 'ended';
  if (c.isActive === false) return 'paused';
  if (start != null && start > now) return 'scheduled';
  return 'live';
}

/** The next moment (ms) any campaign flips state, or null when nothing is pending. */
export function nextBoundary(campaigns, now = Date.now()) {
  let next = null;
  for (const c of campaigns) {
    for (const t of [time(c.startsAt), time(c.endsAt)]) {
      if (t != null && t > now && (next == null || t < next)) next = t;
    }
  }
  return next;
}

/** "2d 4h" · "4h 12m" · "12m" — for static, non-ticking labels. */
export function roughDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/** Only a countdown when the end is near enough that a ticking clock is useful. */
export const COUNTDOWN_WINDOW_MS = 14 * DAY_MS;

/* ------------------------------------------------- <input type="datetime-local"> */

const pad = (n) => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DDTHH:mm" in the viewer's local time, the format the input wants. */
export function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** Local input value → ISO string (what the API validates), or null when blank/invalid. */
export function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 23:59 local, `days` from today — a sale "ending on the 10th" runs through the 10th. */
export function endOfDayIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return toLocalInput(d);
}
