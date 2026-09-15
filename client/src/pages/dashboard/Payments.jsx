import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { inr, longDate, stamp } from '../../lib/format.js';
import { Empty, ErrorNote, Loading, SectionHeader, StatusChip, humanStatus } from '../../components/ui.jsx';

/*
 * Payment & refund tracking. One row per gateway attempt, newest first — a failed
 * attempt followed by a successful one is two rows, because that is what the bank
 * statement will show and hiding the failure invites "was I charged twice?".
 *
 * A refund is rendered inside its payment rather than as its own row: it is a
 * reversal of that specific transaction, and pairing them is what makes the net
 * amount obvious.
 *
 * Amounts arrive as strings from Postgres NUMERIC and are formatted, never
 * summed here — the server's totals are the ones that reconcile.
 */

const EXPLAIN = {
  INITIATED: 'Started but not completed. If money left your account it will be returned automatically.',
  AUTHORIZED: 'Approved by your bank, being captured now.',
  CAPTURED: 'Paid in full.',
  FAILED: 'Not charged. Your bank may still show a temporary hold for a day or two.',
  REFUNDED: 'Returned to the original payment method.',
};

export default function Payments() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['payments'],
    queryFn: ({ signal }) => api.payments({ limit: 50 }, signal),
    staleTime: 30_000,
  });

  if (isPending) return <Loading label="Loading your transactions…" />;
  if (isError) return <ErrorNote error={error} />;

  const payments = data.payments ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Payments & refunds"
        hint="Every attempt against your account, including the ones that did not go through."
      />

      {payments.length === 0 ? (
        <Empty
          title="No transactions yet"
          hint="You can browse and plan without paying — an account is only needed at checkout."
          actionTo="/"
          actionLabel="Find a tour"
        />
      ) : (
        <ul className="space-y-3">
          {payments.map((p) => (
            <li key={p.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <Link to={`/tours/${p.booking.tourSlug}`} className="hover:underline">
                      {p.booking.tourTitle}
                    </Link>
                  </p>
                  <p className="muted mt-1 text-sm">
                    {longDate(p.booking.date)} · {p.booking.seatCount}{' '}
                    {p.booking.seatCount === 1 ? 'seat' : 'seats'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black tabular-nums">{inr(p.amount)}</p>
                  <p className="mt-1">
                    <StatusChip status={p.status} />
                  </p>
                </div>
              </div>

              <p className="muted mt-2 text-sm">{EXPLAIN[p.status] ?? humanStatus(p.status)}</p>

              {p.failureReason && (
                <p className="notice-error mt-2 text-sm">Bank response: {p.failureReason}</p>
              )}

              {p.refund && (
                <div className="mt-3 rounded-xl bg-sky-50 p-3 text-sm dark:bg-sky-500/10">
                  <p className="font-semibold">Refunded {inr(p.refund.amount)}</p>
                  <p className="muted mt-0.5 text-xs">
                    {p.refund.at ? `Processed ${stamp(p.refund.at)}. ` : ''}
                    Typically 5–7 working days to appear on your statement.
                    {p.refund.reference && (
                      <>
                        {' '}
                        Reference <span className="font-mono">{p.refund.reference}</span>.
                      </>
                    )}
                  </p>
                </div>
              )}

              <dl className="faint mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <Pair label="Booking" value={p.booking.reference} mono />
                <Pair label="Attempted" value={stamp(p.createdAt)} />
                {p.gateway && <Pair label="Gateway" value={p.gateway} />}
                {p.gatewayPaymentId && <Pair label="Transaction" value={p.gatewayPaymentId} mono />}
              </dl>

              {/*
                Signature verification is the server-side check that a gateway
                callback really came from the gateway. Surfacing it here gives
                support something concrete to ask about; PCI-wise there is nothing
                sensitive in it, since no card data ever reaches our servers.
              */}
              {p.status === 'CAPTURED' && !p.signatureVerified && (
                <p className="notice-error mt-2 text-xs">
                  This payment has not passed signature verification. It is being reviewed — please
                  contact support before travelling.
                </p>
              )}

              <p className="mt-3 flex flex-wrap gap-3 text-xs">
                {p.booking.status !== 'PENDING' && (
                  <Link to="/dashboard/documents" className="underline">
                    Invoice PDF
                  </Link>
                )}
                <Link
                  to="/dashboard/support"
                  state={{ bookingId: p.booking.id, category: p.refund ? 'REFUND' : 'PAYMENT' }}
                  className="underline"
                >
                  Question about this payment
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pair({ label, value, mono = false }) {
  return (
    <div className="flex gap-2">
      <dt>{label}</dt>
      <dd className={`truncate ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
