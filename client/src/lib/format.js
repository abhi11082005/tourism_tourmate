/** Money arrives from the API as a string (Postgres NUMERIC) — never parse it
 *  for display, only for arithmetic that the server has already agreed to. */
export const inr = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(amount ?? 0));

export const shortDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });

export const longDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/*
 * shortDate/longDate take a DATE ('2026-09-06') and append a time so the string
 * is parsed in local time rather than UTC — without it, IST users see the
 * previous day. Timestamps from TIMESTAMPTZ columns already carry a zone, so
 * they need the opposite treatment: parse as-is.
 */
export const stamp = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Coarse "2 hours ago" for activity and support threads. */
export const ago = (iso) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const steps = [
    [60, 'just now', 1],
    [3600, 'min', 60],
    [86_400, 'hr', 3600],
    [604_800, 'day', 86_400],
  ];
  for (const [limit, unit, divisor] of steps) {
    if (seconds < limit) {
      if (unit === 'just now') return unit;
      const n = Math.floor(seconds / divisor);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return stamp(iso);
};

export const mmss = (totalSeconds) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const toIsoDate = (date) => date.toISOString().slice(0, 10);

/** Human label for a seat count, used in the calendar and the hold banner. */
export const seatLabel = (n) => (n === 1 ? '1 seat left' : `${n} seats left`);

export const km = (metres) =>
  metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;

export const minutes = (seconds) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
