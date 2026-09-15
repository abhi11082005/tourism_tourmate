import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { inr, longDate } from '../../lib/format.js';
import { Empty, ErrorNote, Loading, SectionHeader, StatusChip } from '../../components/ui.jsx';

/*
 * Tickets & invoices.
 *
 * Both documents are generated per request and streamed — nothing is stored, so a
 * cancelled booking cannot leave a stale ticket behind, and there is no bucket to
 * secure.
 *
 * Which documents exist follows the server's rule exactly (assertDocumentAllowed):
 *   * a ticket needs a CONFIRMED booking — it is a boarding pass, and one for an
 *     unpaid seat would be a forgery;
 *   * an invoice exists for anything except a PENDING hold, cancellations
 *     included, because the invoice is what documents the refund.
 * Mirroring the rule here means the button is absent rather than failing.
 */

const canTicket = (b) => b.status === 'CONFIRMED';
const canInvoice = (b) => b.status !== 'PENDING';

export default function Documents() {
  const [busy, setBusy] = useState(null); // `${id}:TICKET` | `${id}:INVOICE`
  const [error, setError] = useState(null);

  const { data, isPending, isError, error: loadError } = useQuery({
    queryKey: ['bookings'],
    queryFn: ({ signal }) => api.myBookings(signal),
    staleTime: 30_000,
  });

  if (isPending) return <Loading label="Loading your documents…" />;
  if (isError) return <ErrorNote error={loadError} />;

  // A PENDING hold has no paperwork at all, so it is not a row here — it would
  // only be a line with two disabled buttons.
  const items = (data.items ?? []).filter((b) => canTicket(b) || canInvoice(b));

  const get = async (booking, kind) => {
    setError(null);
    setBusy(`${booking.id}:${kind}`);
    try {
      if (kind === 'TICKET') await api.ticketPdf(booking.id, booking.reference);
      else await api.invoicePdf(booking.id, booking.reference);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Tickets & invoices"
        hint="PDFs are built when you ask for them, so they always match the current state of the booking."
      />

      <ErrorNote error={error} />

      {items.length === 0 ? (
        <Empty
          title="No documents yet"
          hint="Once a booking is paid for, its ticket and invoice appear here."
          actionTo="/"
          actionLabel="Find a tour"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((b) => (
            <li key={b.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  <Link to={`/tours/${b.tourSlug}`} className="hover:underline">
                    {b.tourTitle}
                  </Link>
                </p>
                <p className="muted mt-1 text-sm">
                  {longDate(b.bookingDate)} · {b.seatCount} {b.seatCount === 1 ? 'seat' : 'seats'} ·{' '}
                  {inr(b.totalAmount)}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <StatusChip status={b.status} />
                  <span className="faint font-mono">{b.reference}</span>
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {canTicket(b) && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy !== null}
                    onClick={() => get(b, 'TICKET')}
                  >
                    {busy === `${b.id}:TICKET` ? 'Preparing…' : 'Ticket PDF'}
                  </button>
                )}
                {canInvoice(b) && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy !== null}
                    onClick={() => get(b, 'INVOICE')}
                  >
                    {busy === `${b.id}:INVOICE` ? 'Preparing…' : 'Invoice PDF'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="faint text-xs">
        Trouble opening a PDF? Check that your browser is not blocking downloads for this site, then
        try again — nothing is deducted or changed by downloading a document.
      </p>
    </div>
  );
}
