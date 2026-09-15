import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { loadRazorpay } from '../lib/razorpay.js';
import { useCountdown } from '../hooks/useCountdown.js';
import { inr, mmss } from '../lib/format.js';

/*
 * Checkout — the only page behind the login wall from the first paint.
 *
 * Seats are already held in Redis by the time we get here; this page's whole job
 * is to (a) show how long the hold has left, (b) hand off to the gateway, and
 * (c) confirm with the signature the gateway returns.
 *
 * Card details never touch our code or our server. The gateway's own SDK collects
 * them, which is what keeps Tour Mate out of PCI-DSS cardholder-data scope.
 */

export default function Checkout() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [failure, setFailure] = useState(null);
  const [paying, setPaying] = useState(false);

  /*
   * True from the moment the gateway window opens until it closes. The pagehide
   * beacon below reads this: on Android, paying by UPI backgrounds the tab and
   * fires pagehide, and releasing the seats there would cancel the booking the
   * traveller is in the middle of paying for.
   */
  const gatewayOpen = useRef(false);

  const { data, isPending, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['booking-state', bookingId],
    queryFn: ({ signal }) => api.bookingState(bookingId, signal),
    // The countdown is local; this poll is the reconciliation against the server.
    refetchInterval: 20_000,
    staleTime: 0,
  });

  /*
   * The server sends a *relative* secondsLeft, but useCountdown needs an absolute
   * deadline — and that deadline must be stable across renders. Anchoring it to
   * dataUpdatedAt (the moment the fetch landed) rather than Date.now() is the
   * whole trick: computed inline, it produced a new ISO string on every render,
   * which reset useCountdown's effect every tick and pinned the timer at its
   * start value. It only moves now when a poll actually lands.
   */
  const expiresAt = useMemo(
    () =>
      data?.secondsLeft == null
        ? null
        : new Date(dataUpdatedAt + data.secondsLeft * 1000).toISOString(),
    [dataUpdatedAt, data?.secondsLeft]
  );

  const secondsLeft = useCountdown(expiresAt, () => refetch());

  const extend = useMutation({
    mutationFn: () => api.extendHold(bookingId),
    onSuccess: () => refetch(),
  });

  const abandon = useMutation({
    mutationFn: () => api.abandon(bookingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      navigate('/');
    },
  });

  const confirm = useMutation({
    mutationFn: (payment) => api.confirm(bookingId, payment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      // The dashboard tiles and the payments ledger both move on a capture.
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      navigate('/dashboard/trips');
    },
    onError: (err) => {
      /*
       * The money may well have been taken — this is our own verification or
       * network failing, not the card. Never imply the payment did not happen;
       * point at the reference so support can reconcile.
       */
      setPaying(false);
      setFailure(
        `${err.message} If you were charged, do not pay again — quote reference ${
          data?.reference ?? bookingId
        } and we'll sort it out.`
      );
    },
  });

  // Release the hold if the traveller navigates away without paying, instead of
  // making the next buyer wait out the full 10 minutes.
  useEffect(() => {
    const release = () => {
      // Not while the gateway window owns the screen: a UPI app switch fires
      // pagehide, and cancelling there would kill a live payment.
      if (gatewayOpen.current) return;
      if (data?.status === 'PENDING') api.abandonBeacon(bookingId);
    };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [bookingId, data?.status]);

  /*
   * The whole payment handoff, in order:
   *   1. Ask our server for an order. It decides the amount from the booking row,
   *      so nothing here can change the price.
   *   2. Load the gateway script (cached after the first checkout).
   *   3. Open Razorpay's window. Card details are typed inside it — this code
   *      never sees them, which is what keeps us in PCI-DSS SAQ-A scope.
   *   4. Hand the signature back to our server, which verifies it against the
   *      key secret before a single seat is confirmed.
   */
  const pay = useCallback(async () => {
    setFailure(null);
    setPaying(true);

    let order;
    let Razorpay;
    try {
      // Both in parallel: the script fetch does not depend on the order.
      [order, Razorpay] = await Promise.all([api.createOrder(bookingId), loadRazorpay()]);
    } catch (err) {
      setPaying(false);
      setFailure(err.message);
      return;
    }

    // Fire-and-forget: a failed ledger write must not block a retry.
    const markFailed = (reason) =>
      api.paymentFailed(bookingId, { orderId: order.orderId, reason: reason.slice(0, 300) }).catch(
        () => {}
      );

    const rzp = new Razorpay({
      key: order.keyId, // publishable id; the secret never leaves the server
      order_id: order.orderId,
      amount: order.amount, // paise, straight from the server
      currency: order.currency,
      name: 'Tour Mate',
      description: order.tourTitle,
      prefill: order.prefill,
      notes: { reference: order.reference },
      theme: { color: '#4f46e5' },
      retry: { enabled: false }, // we own retries, so the ledger stays truthful
      handler: (response) => {
        gatewayOpen.current = false;
        confirm.mutate({
          gateway: order.gateway,
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        });
      },
      modal: {
        /*
         * Closing the window is NOT a failed payment, so it is deliberately not
         * reported as one. recordFailedAttempt only touches INITIATED rows and
         * order reuse only looks for INITIATED rows, so marking a dismissal as a
         * failure would orphan the order on every retry and litter both the
         * Razorpay dashboard and ours with abandoned orders. The seats are still
         * held, so just let them try again — same order, same amount.
         */
        ondismiss: () => {
          gatewayOpen.current = false;
          setPaying(false);
          refetch(); // the hold ticked down while the window was open
        },
      },
    });

    rzp.on('payment.failed', (response) => {
      gatewayOpen.current = false;
      setPaying(false);
      const reason = response?.error?.description ?? 'The payment did not go through';
      markFailed(reason);
      setFailure(`${reason} Your seats are still held — you can try again.`);
    });

    gatewayOpen.current = true;
    rzp.open();
  }, [bookingId, confirm, refetch]);

  if (isPending) return <p className="py-10 text-center text-sm text-sand-500">Loading checkout…</p>;
  if (isError) return <p className="py-10 text-center text-sm text-red-700">{error.message}</p>;

  if (data.status === 'CONFIRMED') {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <h1 className="text-xl font-bold">You&apos;re booked</h1>
        <p className="mt-2 text-sm text-ink-700">
          Reference <span className="font-mono font-semibold">{data.reference}</span>. The invoice and
          day-wise itinerary are on their way to your inbox.
        </p>
        <Link to="/dashboard/trips" className="btn-primary mt-4 w-full">
          See my trips
        </Link>
        <Link to="/dashboard/documents" className="btn-ghost mt-2 w-full">
          Ticket &amp; invoice
        </Link>
      </div>
    );
  }

  if (data.status !== 'PENDING' || !data.holdActive) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <h1 className="text-xl font-bold">The hold expired</h1>
        <p className="mt-2 text-sm text-ink-700">
          Those seats went back into the pool. Nothing was charged — pick a date again and we&apos;ll
          hold a fresh set.
        </p>
        <Link to="/" className="btn-primary mt-4 w-full">
          Back to tours
        </Link>
      </div>
    );
  }

  const urgent = secondsLeft <= 120;
  // One flag for "a payment is in flight" — covers both the gateway window being
  // open and our own confirm call, so neither button can fire twice.
  const busy = paying || confirm.isPending;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div
        className={`rounded-2xl p-4 text-center ${
          urgent ? 'bg-red-50 text-red-800' : 'bg-sand-100 text-ink-800'
        }`}
        role="status"
        aria-live="polite"
      >
        <p className="text-xs uppercase tracking-wide">Seats held for</p>
        <p className="text-3xl font-black tabular-nums">{mmss(secondsLeft)}</p>
        <p className="mt-1 text-xs">
          Nobody else can take them until the timer runs out.{' '}
          <button
            type="button"
            className="underline disabled:opacity-50"
            onClick={() => extend.mutate()}
            disabled={extend.isPending}
          >
            Need longer?
          </button>
        </p>
      </div>

      <section className="card p-4">
        <h1 className="text-lg font-bold">Confirm and pay</h1>
        <p className="text-xs text-sand-500">
          Reference <span className="font-mono">{data.reference}</span>
        </p>

        <ul className="mt-4 space-y-1 text-sm">
          {(data.breakdown?.lines ?? []).map((line) => (
            <li key={line.key} className="flex justify-between gap-3">
              <span className="text-ink-700">{line.label}</span>
              <span className="tabular-nums">{inr(line.amount)}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 flex items-baseline justify-between border-t border-sand-100 pt-3">
          <span className="font-semibold">Amount payable</span>
          <span className="text-xl font-bold tabular-nums">{inr(data.totalAmount)}</span>
        </p>

        {failure && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
            {failure}
          </p>
        )}

        {data.paymentsEnabled === false && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="status">
            Payments aren&apos;t configured on this server yet. Add RAZORPAY_KEY_ID and
            RAZORPAY_KEY_SECRET to <span className="font-mono">server/.env</span> and restart it.
          </p>
        )}

        <button
          type="button"
          className="btn-primary mt-4 w-full"
          disabled={busy || data.paymentsEnabled === false}
          onClick={pay}
        >
          {confirm.isPending
            ? 'Confirming…'
            : paying
              ? 'Opening secure checkout…'
              : `Pay ${inr(data.totalAmount)}`}
        </button>

        <button
          type="button"
          className="btn-ghost mt-2 w-full"
          onClick={() => abandon.mutate()}
          disabled={abandon.isPending || busy}
        >
          Release these seats
        </button>

        <p className="mt-3 text-center text-[11px] text-sand-500">
          Card details are entered inside the gateway&apos;s own window. They never reach Tour
          Mate&apos;s servers.
        </p>
      </section>
    </div>
  );
}
