import { Link } from 'react-router-dom';

/*
 * The handful of shapes every dashboard module needs: a heading, a spinner line,
 * an error line, an empty state, a stat tile and a status pill.
 *
 * They live in one file because seven modules writing their own "Loading…" is how
 * an app ends up with seven slightly different greys and one missing role="alert".
 * Nothing here holds state or fetches anything.
 */

/** Status vocabulary of the whole app: bookings, payments and tickets. */
const TONE = {
  // bookings
  CONFIRMED: 'ok',
  PENDING: 'warn',
  CANCELLED: 'mute',
  EXPIRED: 'mute',
  // payments
  INITIATED: 'warn',
  AUTHORIZED: 'warn',
  CAPTURED: 'ok',
  FAILED: 'bad',
  REFUNDED: 'info',
  // tickets
  OPEN: 'warn',
  AWAITING_CUSTOMER: 'info',
  RESOLVED: 'ok',
  CLOSED: 'mute',
  // ticket priority
  LOW: 'mute',
  NORMAL: 'mute',
  HIGH: 'warn',
  URGENT: 'bad',
};

const TONE_CLASS = {
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  bad: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
  info: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  mute: 'bg-sand-100 text-sand-500 dark:bg-ink-800 dark:text-sand-400',
};

/** CAPTURED → "captured", AWAITING_CUSTOMER → "awaiting customer". */
export const humanStatus = (status) => String(status ?? '').toLowerCase().replace(/_/g, ' ');

export function StatusChip({ status, label }) {
  if (!status) return null;
  return (
    <span className={`chip ${TONE_CLASS[TONE[status] ?? 'mute']}`}>{label ?? humanStatus(status)}</span>
  );
}

export function SectionHeader({ title, hint, children }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-black">{title}</h1>
        {hint && <p className="muted text-sm">{hint}</p>}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </header>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <p className="faint py-10 text-center text-sm" role="status">
      {label}
    </p>
  );
}

/** Accepts an Error or a string; renders nothing when there is nothing wrong. */
export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <p className="notice-error" role="alert">
      {typeof error === 'string' ? error : error.message}
    </p>
  );
}

export function Empty({ title, hint, actionTo, actionLabel }) {
  return (
    <div className="card p-6 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="muted mt-1 text-sm">{hint}</p>}
      {actionTo && (
        <Link to={actionTo} className="btn-primary mt-4 inline-block">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

/**
 * A number and what it means. `to` makes the whole tile a link, which is the
 * behaviour people expect from a dashboard counter.
 */
export function Stat({ label, value, hint, to }) {
  const body = (
    <>
      <p className="faint text-xs uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
      {hint && <p className="muted mt-0.5 text-xs">{hint}</p>}
    </>
  );

  return to ? (
    <Link to={to} className="card block p-4 transition hover:border-teal-400 hover:shadow">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}
