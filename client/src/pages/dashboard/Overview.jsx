import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { inr, longDate, ago } from '../../lib/format.js';
import { Empty, ErrorNote, Loading, Stat, StatusChip } from '../../components/ui.jsx';

/*
 * Overview: the answers to "what's next?", "what did I spend?" and "what have I
 * written lately?" without a click.
 *
 * Three independent queries rather than one aggregate endpoint, because each has
 * its own natural staleness and the tiles should not wait for the activity log.
 */

export default function Overview() {
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: ({ signal }) => api.summary(signal),
    staleTime: 60_000,
  });

  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: ({ signal }) => api.myBookings(signal),
    staleTime: 30_000,
  });

  const activity = useQuery({
    queryKey: ['activity', 5],
    queryFn: ({ signal }) => api.activity({ limit: 5 }, signal),
    staleTime: 60_000,
  });

  if (summary.isPending) return <Loading label="Loading your dashboard…" />;
  if (summary.isError) return <ErrorNote error={summary.error} />;

  // Every endpoint wraps its payload ({ summary }, { activity }, { items }) —
  // one envelope per response is what lets a route add a sibling field later
  // without breaking the client.
  const s = summary.data.summary;
  const recent = activity.data?.activity ?? [];
  const items = bookings.data?.items ?? [];
  const today = new Date().toISOString().slice(0, 10);

  // /bookings/mine already sorts upcoming-first, so the first match is the next
  // departure — no second sort here.
  const next = items.find((b) => b.status === 'CONFIRMED' && b.bookingDate >= today);
  const hold = items.find((b) => b.status === 'PENDING');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Upcoming" value={s.upcomingTrips} hint="confirmed trips" to="/dashboard/trips" />
        <Stat label="Completed" value={s.pastTrips} hint="trips taken" to="/dashboard/trips" />
        <Stat label="Saved" value={s.savedCount} hint="wishlisted tours" to="/dashboard/saved" />
        <Stat
          label="Reviews"
          value={s.reviewCount + s.commentCount}
          hint="reviews & comments"
          to="/dashboard/reviews"
        />
        <Stat label="Spent" value={inr(s.lifetimeSpend)} hint="lifetime, confirmed" to="/dashboard/payments" />
        <Stat label="Refunded" value={inr(s.refundedTotal)} hint="back to you" to="/dashboard/payments" />
        <Stat label="Open tickets" value={s.openTickets} hint="with support" to="/dashboard/support" />
        <Stat label="Held seats" value={s.liveHolds} hint="awaiting payment" to="/dashboard/trips" />
      </div>

      {/* A live hold expires in minutes, so it outranks everything else here. */}
      {hold && (
        <section className="card border-amber-300 p-4 dark:border-amber-500/40">
          <h2 className="font-bold">Seats are being held for you</h2>
          <p className="muted mt-1 text-sm">
            {hold.tourTitle} · {longDate(hold.bookingDate)} · {inr(hold.totalAmount)}
          </p>
          <Link to={`/checkout/${hold.id}`} className="btn-primary mt-3 inline-block">
            Finish paying
          </Link>
        </section>
      )}

      <section>
        <h2 className="text-lg font-bold">Next trip</h2>
        {bookings.isPending ? (
          <Loading label="Checking your trips…" />
        ) : next ? (
          <article className="card mt-2 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            {next.coverImage && (
              <img
                src={next.coverImage}
                alt=""
                loading="lazy"
                className="h-24 w-full rounded-xl object-cover sm:w-36"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                <Link to={`/tours/${next.tourSlug}`} className="hover:underline">
                  {next.tourTitle}
                </Link>
              </p>
              <p className="muted mt-1 text-sm">
                {longDate(next.bookingDate)} · {next.seatCount}{' '}
                {next.seatCount === 1 ? 'seat' : 'seats'}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <StatusChip status={next.status} />
                <span className="faint font-mono">{next.reference}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link to="/dashboard/documents" className="btn-ghost">
                Ticket
              </Link>
              <Link to="/explore" className="btn-primary">
                Guided route
              </Link>
            </div>
          </article>
        ) : (
          <div className="mt-2">
            <Empty
              title="No trips booked yet"
              hint="Browse as long as you like — you only need to pay when you are ready."
              actionTo="/"
              actionLabel="Find a tour"
            />
          </div>
        )}
      </section>

      <section>
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-bold">Recent activity</h2>
          <Link to="/dashboard/reviews" className="faint text-xs underline">
            See all
          </Link>
        </div>
        {activity.isPending ? (
          <Loading label="Loading your reviews…" />
        ) : recent.length === 0 ? (
          <p className="muted mt-2 text-sm">
            Nothing written yet. Reviews you leave on a tour show up here.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((a) => (
              <li key={`${a.kind}-${a.id}`} className="card p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <StatusChip status={a.kind === 'REVIEW' ? 'RESOLVED' : 'AWAITING_CUSTOMER'} label={a.kind.toLowerCase()} />
                  <Link to={`/tours/${a.tourSlug}`} className="font-semibold hover:underline">
                    {a.tourTitle}
                  </Link>
                  {a.rating != null && <span aria-label={`${a.rating} out of 5`}>{'★'.repeat(a.rating)}</span>}
                  <span className="faint text-xs">{ago(a.createdAt)}</span>
                </p>
                <p className="muted mt-1 line-clamp-2">{a.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
