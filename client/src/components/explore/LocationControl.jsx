import { useState } from 'react';
import { LocateFixed, RefreshCw, X } from 'lucide-react';

/*
 * Floating "my location" controls, and the one place location wording lives.
 *
 * Wording rule: only a real GPS fix is ever called "your location". A remembered
 * position or Jaipur is always "approximate" and named as such.
 */

export function describeLocation(geo) {
  if (geo.state === 'locating') return { tone: 'info', text: 'Finding your location…' };
  if (geo.isPrecise) {
    const acc = geo.accuracy != null ? ` (accurate to about ${geo.accuracy < 1000 ? `${Math.round(geo.accuracy)} m` : `${(geo.accuracy / 1000).toFixed(1)} km`})` : '';
    return geo.isRough
      ? { tone: 'warn', text: `Using your location${acc} — the fix is rough, so nearby results may be off.` }
      : { tone: 'ok', text: `Using your current location${acc}.` };
  }
  if (geo.state === 'denied' || geo.permission === 'denied') {
    return {
      tone: 'error',
      text: `Location is blocked for this site. Allow it in your browser's site settings, then tap "Use my location". Meanwhile we're showing ${geo.fallbackLabel} (approximate).`,
    };
  }
  if (geo.state === 'unsupported') return { tone: 'error', text: "This browser can't share its location." };
  if (geo.state === 'timeout') return { tone: 'error', text: 'Getting your location took too long. Try again.' };
  if (geo.state === 'unavailable') return { tone: 'error', text: "Couldn't get a location fix right now. Try again." };
  return {
    tone: 'idle',
    text: `Showing ${geo.fallbackLabel} (approximate). Tap "Use my location" for results around where you actually are — we only ask when you tap.`,
  };
}

const TONE = {
  ok: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  warn: 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  error: 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  info: 'bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
  idle: 'bg-sand-100 text-ink-700 dark:bg-ink-800 dark:text-sand-200',
};

/** Inline status line for the panel header. */
export function LocationNotice({ geo }) {
  const { tone, text } = describeLocation(geo);
  return (
    <p role="status" className={`rounded-xl px-3 py-2 text-xs leading-snug ${TONE[tone]}`}>
      {text}
    </p>
  );
}

/** Map buttons: use / recentre on my location, and refresh the fix. */
export function LocationControl({ geo, onUse, onRefresh }) {
  const locating = geo.state === 'locating';
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onUse}
        disabled={locating}
        aria-label={geo.isPrecise ? 'Return to my location' : 'Use my location'}
        title={geo.isPrecise ? 'Return to my location' : 'Use my location'}
        className={`grid h-11 w-11 place-items-center rounded-full border shadow-lg transition disabled:opacity-60 ${
          geo.isPrecise
            ? 'border-sky-500 bg-sky-500 text-white'
            : 'border-sand-300 bg-white text-ink-800 hover:bg-sand-100 dark:border-ink-600 dark:bg-ink-800 dark:text-sand-50 dark:hover:bg-ink-700'
        }`}
      >
        <LocateFixed className={`h-5 w-5 ${locating ? 'animate-pulse' : ''}`} aria-hidden />
      </button>
      {geo.isPrecise && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={locating}
          aria-label="Refresh my location"
          title="Refresh my location"
          className="grid h-11 w-11 place-items-center rounded-full border border-sand-300 bg-white text-ink-800 shadow-lg hover:bg-sand-100 disabled:opacity-60 dark:border-ink-600 dark:bg-ink-800 dark:text-sand-50 dark:hover:bg-ink-700"
        >
          <RefreshCw className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Failure toast: location errors must be visible immediately, even with the sheet collapsed. */
export function LocationToast({ geo }) {
  const [dismissed, setDismissed] = useState(null);
  const failed = ['denied', 'unsupported', 'timeout', 'unavailable'].includes(geo.state);
  if (!failed || dismissed === geo.state) return null;
  const { text } = describeLocation(geo);
  return (
    <div
      role="alert"
      className="pointer-events-auto flex max-w-xs items-start gap-2 rounded-2xl border border-red-200 bg-white p-3 text-xs text-red-800 shadow-xl dark:border-red-900 dark:bg-ink-900 dark:text-red-200"
    >
      <span className="flex-1">{text}</span>
      <button type="button" onClick={() => setDismissed(geo.state)} aria-label="Dismiss" className="shrink-0">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
