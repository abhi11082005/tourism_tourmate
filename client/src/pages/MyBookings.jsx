import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { inr, longDate } from '../lib/format.js';
import { Empty, ErrorNote, Loading, SectionHeader, StatusChip } from '../components/ui.jsx';

/*
 * My trips — a dashboard module, reachable at /dashboard/trips.
 *
 * Three groups, because a traveller's questions differ per group: "when do I go?"
 * (upcoming), "can I still pay?" (pending holds) and "what did I spend?"
 * (past/cancelled).
 *
 * A PENDING row is a live Redis hold, so it links straight back to checkout —
 * losing that link is how travellers end up double-booking.
 */

export default function MyBookings() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const { data, isPending, isError, error: loadError } = useQuery({
    queryKey: ['bookings'],
    queryFn: ({ signal }) => api.myBookings(signal),
    staleTime: 30_000,
  });

  const cancel = useMutation({
    mutationFn: (id) => api.cancel(id),
    onMutate: (id) => {
      setBusyId(id);
      setError(null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      // The seat count and the spend tiles both move when a trip is cancelled.
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err) => setError(err.message),
    onSettled: () => setBusyId(null),
  });

  const groups = useMemo(() => {
    const items = data?.items ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return {
      upcoming: items.filter((b) => b.status === 'CONFIRMED' && b.bookingDate >= today),
      pending: items.filter((b) => b.status === 'PENDING'),
      past: items.filter(
        (b) =>
          b.status === 'CANCELLED' ||
          b.status === 'EXPIRED' ||
          (b.status === 'CONFIRMED' && b.bookingDate < today)
      ),
    };
  }, [data]);

  if (isPending) return <Loading label="Loading your trips…" />;
  if (isError) return <ErrorNote error={loadError} />;

  const empty = (data?.items ?? []).length === 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="My trips"
        hint="Every booking, invoice reference and departure date."
      />

      <ErrorNote error={error} />

      {empty && (
        <Empty
          title="You haven't booked anything yet"
          hint="Browse as long as you like — an account is only needed at the payment step."
          actionTo="/"
          actionLabel="Find a tour"
        />
      )}

      {groups.pending.length > 0 && (
        <Group title="Waiting on payment" hint="Seats are only held for a few minutes.">
          {groups.pending.map((b) => (
            <BookingRow key={b.id} booking={b}>
              <Link to={`/checkout/${b.id}`} className="btn-primary">
                Finish paying
              </Link>
            </BookingRow>
          ))}
        </Group>
      )}

      {groups.upcoming.length > 0 && (
        <Group title="Coming up">
          {groups.upcoming.map((b) => (
            <BookingRow key={b.id} booking={b}>
              <Link to="/dashboard/documents" className="btn-ghost">
                Ticket
              </Link>
              <Link to="/explore" className="btn-ghost">
                Guided route
              </Link>
              <button
                type="button"
                className="btn-ghost"
                disabled={busyId === b.id}
                onClick={() => cancel.mutate(b.id)}
              >
                {busyId === b.id ? 'Cancelling…' : 'Cancel'}
              </button>
            </BookingRow>
          ))}
        </Group>
      )}

      {groups.past.length > 0 && (
        <Group title="Earlier trips">
          {groups.past.map((b) => (
            <BookingRow key={b.id} booking={b}>
              <Link to={`/tours/${b.tourSlug}`} className="btn-ghost">
                Book again
              </Link>
            </BookingRow>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, hint, children }) {
  return (
    <section>
      <h2 className="text-lg font-bold">{title}</h2>
      {hint && <p className="faint text-xs">{hint}</p>}
      <ul className="mt-3 space-y-3">{children}</ul>
    </section>
  );
}

function BookingRow({ booking, children }) {
  return (
    <li className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        {booking.coverImage && (
          <img
            src={booking.coverImage}
            alt=""
            loading="lazy"
            className="hidden h-16 w-24 shrink-0 rounded-xl object-cover sm:block"
          />
        )}
        <div className="min-w-0">
          <p className="font-semibold">
            <Link to={`/tours/${booking.tourSlug}`} className="hover:underline">
              {booking.tourTitle}
            </Link>
          </p>
          <p className="muted mt-1 text-sm">
            {longDate(booking.bookingDate)} · {booking.seatCount}{' '}
            {booking.seatCount === 1 ? 'seat' : 'seats'} · {inr(booking.totalAmount)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <StatusChip status={booking.status} />
            {/* The payment status only earns a chip when it differs from the
                booking's own — otherwise it is the same fact twice. */}
            {booking.paymentStatus && booking.paymentStatus !== booking.status && (
              <StatusChip status={booking.paymentStatus} />
            )}
            <span className="faint font-mono">{booking.reference}</span>
            {booking.refund && (
              <span className="faint">· {inr(booking.refund.amount)} refunded</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
    </li>
  );
}
