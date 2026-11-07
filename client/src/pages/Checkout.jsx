import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { loadRazorpay } from '../lib/razorpay.js';
import { useCountdown } from '../hooks/useCountdown.js';
import { inr, mmss } from '../lib/format.js';

export default function Checkout() {
  const { bookingId } = useParams();
  const navigate = useNavigate(); 
  const qc = useQueryClient();
  const [failure, setFailure] = useState(null);
  const [paying, setPaying] = useState(false);
  const gatewayOpen = useRef(false);

  const { data, isPending, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['booking-state', bookingId],
    queryFn: ({ signal }) => api.bookingState(bookingId, signal),
    refetchInterval: 20_000,
    staleTime: 0,
  });

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
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      navigate('/dashboard/trips');
    },
    onError: (err) => {
      setPaying(false);
      setFailure(
        `${err.message} If you were charged, do not pay again — quote reference ${
          data?.reference ?? bookingId
        } and we'll sort it out.`
      );
    },
  });

  useEffect(() => {
    const release = () => {
      if (gatewayOpen.current) return;
      if (data?.status === 'PENDING') api.abandonBeacon(bookingId);
    };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [bookingId, data?.status]);

  const pay = useCallback(async () => {
    setFailure(null);
    setPaying(true);

    let order;
    let Razorpay;
    try {
      [order, Razorpay] = await Promise.all([api.createOrder(bookingId), loadRazorpay()]);
    } catch (err) {
      setPaying(false);
      setFailure(err.message);
      return;
    }

    const markFailed = (reason) =>
      api.paymentFailed(bookingId, { orderId: order.orderId, reason: reason.slice(0, 300) }).catch(
        () => {}
      );

    const rzp = new Razorpay({
      key: order.keyId, 
      order_id: order.orderId,
      amount: order.amount, 
      currency: order.currency,
      name: 'Tour Mate',
      description: order.tourTitle,
      prefill: order.prefill,
      notes: { reference: order.reference },
      theme: { color: '#4f46e5' },
      retry: { enabled: false }, 
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
        ondismiss: () => {
          gatewayOpen.current = false;
          setPaying(false);
          refetch(); 
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

  if (isPending) return <p className="py-10 text-center text-sm text-sand-500 dark:text-sand-400">Loading checkout…</p>;
  if (isError) return <p className="py-10 text-center text-sm text-red-700 dark:text-red-400">{error.message}</p>;

  if (data.status === 'CONFIRMED') {
    return (
      <div className="card mx-auto max-w-md p-6 text-center dark:bg-ink-900 dark:border-ink-800">
        <h1 className="text-xl font-bold dark:text-sand-50">You&apos;re booked</h1>
        <p className="mt-2 text-sm text-ink-700 dark:text-sand-300">
          Reference <span className="font-mono font-semibold dark:text-white">{data.reference}</span>. The invoice and
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
      <div className="card mx-auto max-w-md p-6 text-center dark:bg-ink-900 dark:border-ink-800">
        <h1 className="text-xl font-bold dark:text-sand-50">The hold expired</h1>
        <p className="mt-2 text-sm text-ink-700 dark:text-sand-300">
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
  const busy = paying || confirm.isPending;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div
        className={`rounded-2xl p-4 text-center ${
          urgent 
            ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400' 
            : 'bg-sand-100 text-ink-800 dark:bg-ink-800 dark:text-sand-50'
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

      <section className="card p-4 dark:bg-ink-900 dark:border-ink-800">
        <h1 className="text-lg font-bold dark:text-sand-50">Confirm and pay</h1>
        <p className="text-xs text-sand-500 dark:text-sand-400">
          Reference <span className="font-mono">{data.reference}</span>
        </p>

        {/* Note: If a discount campaign exists, the server's breakdown will automatically render it here */}
        <ul className="mt-4 space-y-1 text-sm">
          {(data.breakdown?.lines ?? []).map((line) => (
            <li key={line.key} className="flex justify-between gap-3">
              <span className={`text-ink-700 dark:text-sand-300 ${line.amount.startsWith('-') ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                {line.label}
              </span>
              <span className={`tabular-nums dark:text-sand-50 ${line.amount.startsWith('-') ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                {line.amount.startsWith('-') ? `-${inr(line.amount.substring(1))}` : inr(line.amount)}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 flex items-baseline justify-between border-t border-sand-100 dark:border-ink-700 pt-3">
          <span className="font-semibold dark:text-sand-50">Amount payable</span>
          <span className="text-xl font-bold tabular-nums dark:text-white">{inr(data.totalAmount)}</span>
        </p>

        {failure && (
          <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400" role="alert">
            {failure}
          </p>
        )}

        {data.paymentsEnabled === false && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-400" role="status">
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

        <p className="mt-3 text-center text-[11px] text-sand-500 dark:text-sand-400">
          Card details are entered inside the gateway&apos;s own window. They never reach Tour
          Mate&apos;s servers.
        </p>
      </section>
    </div>
  );
} 