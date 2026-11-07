import { Link } from 'react-router-dom';
import { CalendarDays, Flag, Loader2, Lock } from 'lucide-react';
import { shortDate } from '../../lib/format.js';
import RouteSummaryCard from './RouteSummaryCard.jsx';
import { SECTION_LABEL } from './exploreConfig.js';

/*
 * Guided Tour: replay the line a guide drew for one of the traveller's own confirmed
 * departures (or the server's shortest order through the stops when none was drawn).
 * Guests see a sign-in prompt instead — the same `isGuest` condition the page always used.
 */

function Intro() {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-glow/15 text-glow">
        <Flag className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <h2 className="text-lg font-black leading-tight tracking-tight">Guided tour</h2>
        <p className="muted mt-1 text-sm leading-relaxed">
          Follow the exact line your guide will walk on the day. If they haven&apos;t drawn one, we&apos;ll order
          the tour&apos;s stops the shortest way round.
        </p>
      </div>
    </div>
  );
}

function SignInPrompt() {
  return (
    <div className="rounded-2xl border border-sand-200 bg-gradient-to-br from-sand-50 to-sand-100 p-5 text-center dark:border-ink-600 dark:from-ink-800 dark:to-ink-900">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white text-ink-800 shadow-sm dark:bg-ink-700 dark:text-sand-50">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-3 font-bold">Sign in to see your guide&apos;s route</h3>
      <p className="muted mt-1 text-sm">
        Sign in to see the route for a departure you&apos;ve booked.
      </p>
      <Link to="/login" state={{ from: { pathname: '/explore' } }} className="btn-primary mt-4 w-full">
        Sign in
      </Link>
    </div>
  );
}

export default function GuidedTourPlanner({
  isGuest,
  departures,
  slotId,
  onSlotChange,
  onShow,
  guided,
  route,
}) {
  const items = departures.data ?? [];

  return (
    <div className="space-y-5">
      <Intro />

      {isGuest ? (
        <SignInPrompt />
      ) : items.length ? (
        <>
          <fieldset>
            <legend className={`${SECTION_LABEL} mb-2`}>Confirmed departure</legend>
            <div className="max-h-60 space-y-2 overflow-y-auto pr-0.5">
              {items.map((b) => {
                const selected = slotId === b.slotId;
                return (
                  <label key={b.id} className="block cursor-pointer">
                    <input
                      type="radio"
                      name="explore-departure"
                      value={b.slotId}
                      checked={selected}
                      onChange={() => onSlotChange(b.slotId)}
                      className="peer sr-only"
                    />
                    <span
                      className={`flex items-center gap-3 rounded-2xl border p-3 transition-all duration-200
                                  peer-focus-visible:ring-2 peer-focus-visible:ring-glow peer-focus-visible:ring-offset-2 ${
                                    selected
                                      ? 'border-glow bg-glow/10 shadow-sm'
                                      : 'border-sand-200 bg-white/60 hover:border-sand-300 dark:border-ink-600 dark:bg-ink-800/50'
                                  }`}
                    >
                      <span
                        aria-hidden
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
                          selected ? 'bg-glow text-white' : 'bg-sand-100 text-sand-700 dark:bg-ink-700 dark:text-sand-300'
                        }`}
                      >
                        <CalendarDays className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{b.tourTitle}</span>
                        <span className="faint block text-xs">{shortDate(b.bookingDate)}</span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <button
            type="button"
            className="btn-primary w-full min-h-12 text-base shadow-lg"
            disabled={!slotId || guided.isPending}
            aria-busy={guided.isPending}
            onClick={onShow}
          >
            {guided.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading the route…
              </>
            ) : (
              'Show the guided route'
            )}
          </button>

          {guided.isError && (
            <p className="notice-error" role="alert">
              {guided.error.message}
            </p>
          )}

          <RouteSummaryCard route={route} />
        </>
      ) : (
        <p className="muted rounded-2xl border border-dashed border-sand-300 p-4 text-sm dark:border-ink-500">
          {departures.isPending
            ? 'Checking your trips…'
            : departures.isError
              ? departures.error.message
              : 'Once a booking is confirmed, its guided route shows up here.'}
        </p>
      )}
    </div>
  );
}
