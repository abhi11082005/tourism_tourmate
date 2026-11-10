import { useEffect, useRef } from 'react';
import { CircleAlert, Check, Info, LoaderCircle, TicketPercent, TriangleAlert, WifiOff, X } from 'lucide-react';
import { useCoupon } from '../hooks/useCoupon.js';
import { inr } from '../lib/format.js';

/*
 * Promo code entry.
 *
 * Everything shown after "Apply" is the server's answer from /bookings/validate-coupon
 * (via useCoupon): the code, the rupee discount, the total after the coupon. Nothing is
 * calculated or invented here — and there is deliberately no "available offers" list,
 * because the API exposes no public coupon listing (only the admin one).
 *
 * The hook drops an applied coupon whenever the date, party size or options change, so
 * a discount can never outlive the booking it was checked against.
 *
 * `finalAmount` is the total after THIS coupon only. Campaign discounts are applied by
 * checkout on top, so the success card labels it "after coupon" and points to the price
 * summary for the real payable figure instead of presenting it as the final total.
 */

const CSS = `
@keyframes cc-pop{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
@keyframes cc-tick{0%{transform:scale(0)}60%{transform:scale(1.18)}100%{transform:scale(1)}}
.cc-pop{animation:cc-pop .32s ease-out both}
.cc-tick{animation:cc-tick .42s cubic-bezier(.2,.9,.3,1.2) .08s both}
@media (prefers-reduced-motion:reduce){.cc-pop,.cc-tick{animation:none}}
`;

/* tone: 'error' = the code was refused, 'warn' = a temporary problem, not the code's fault */
const COPY = {
  invalid: { tone: 'error', title: 'That code isn’t valid', hint: 'Check the spelling, or try a different code.' },
  expired: { tone: 'error', title: 'This offer has expired', hint: 'Try a different code.' },
  exhausted: { tone: 'error', title: 'This offer is fully redeemed', hint: 'It has reached its usage limit. Try a different code.' },
  minimum: { tone: 'error', title: 'Minimum booking amount not reached', hint: null },
  rate: { tone: 'warn', title: 'Too many attempts', hint: 'Please wait a minute, then try again.' },
  network: {
    tone: 'warn',
    title: 'You seem to be offline',
    hint: 'Check your connection and try again. You can still book at the listed price.',
  },
  unavailable: {
    tone: 'warn',
    title: 'We couldn’t check that code',
    hint: 'This is a temporary problem on our side. Try again shortly — you can still book at the listed price.',
  },
  rejected: { tone: 'error', title: 'That code can’t be applied', hint: null },
};

/* Works with the upgraded hook (errorKind) and, as a fallback, with the old one (message only). */
function inferKind(errorKind, message = '') {
  if (errorKind) return errorKind;
  if (/failed to fetch|network|offline/i.test(message)) return 'network';
  if (/couldn.?t check that code/i.test(message)) return 'unavailable';
  if (/expired/i.test(message) && !/not valid/i.test(message)) return 'expired';
  if (/minimum/i.test(message)) return 'minimum';
  if (/usage limit/i.test(message)) return 'exhausted';
  if (/not valid/i.test(message)) return 'invalid';
  return 'rejected';
}

function offLabel(applied) {
  const value = Number(applied.discountValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (applied.discountType === 'PERCENT') return `${value}% off`;
  if (applied.discountType === 'FLAT') return `${inr(value)} off`;
  return null;
}

export default function CouponField({ tourId, slotId, seatCount, selectedOptions, onAppliedChange, onAmountChange }) {
  const { code, setCode, apply, clear, isChecking, error, errorKind, applied, couponAmount } = useCoupon({
    tourId,
    slotId,
    seatCount,
    selectedOptions,
  });

  // Notify parent of applied object changes
  const notifyApplied = useRef(onAppliedChange);
  notifyApplied.current = onAppliedChange;
  useEffect(() => {
    notifyApplied.current?.(applied);
  }, [applied]);

  // Notify parent of discount amount changes specifically
  const notifyAmount = useRef(onAmountChange);
  notifyAmount.current = onAmountChange;
  useEffect(() => {
    notifyAmount.current?.(couponAmount);
  }, [couponAmount]);

  // An error describes the code that was tried; once the shopper edits it, stop showing it.
  const lastTried = useRef('');
  const canApply = Boolean(slotId) && !isChecking && code.trim().length >= 3;
  const handleApply = () => {
    if (!canApply) return; // also blocks a double submit while a check is running
    lastTried.current = code.trim();
    apply();
  };

  const disabled = !slotId;

  /* ------------------------------------------------------------------ success */
  if (applied) {
    const saving = applied.discountAmount;
    const off = offLabel(applied);
    return (
      <section
        role="status"
        aria-label="Promo code applied"
        className="cc-pop overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white shadow-sm dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-ink-900"
      >
        <style>{CSS}</style>
        <div className="flex items-start gap-3 p-4">
          <span
            aria-hidden="true"
            className="cc-tick grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white dark:bg-emerald-400 dark:text-ink-900"
          >
            <Check className="h-5 w-5" strokeWidth={3} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Promo code applied</p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-dashed border-emerald-400 bg-white px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-emerald-800 dark:border-emerald-400/50 dark:bg-ink-900 dark:text-emerald-200">
                {applied.code}
              </span>
              {off && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
                  {off}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={clear}
            aria-label={`Remove coupon ${applied.code}`}
            className="-mr-1 -mt-1 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 dark:text-emerald-100 dark:hover:bg-emerald-500/15"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>

        {(saving != null || applied.finalAmount != null) && (
          <div className="border-t border-dashed border-emerald-300/80 bg-white/60 px-4 py-3 dark:border-emerald-500/25 dark:bg-transparent">
            {saving != null && (
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-emerald-900 dark:text-emerald-100">You’re saving</span>
                <span className="text-2xl font-black tabular-nums text-emerald-700 dark:text-emerald-300">{inr(saving)}</span>
              </p>
            )}
            {applied.finalAmount != null && (
              <p className="mt-1 flex items-baseline justify-between gap-3 text-sm text-emerald-900/80 dark:text-emerald-100/80">
                <span>Total after coupon</span>
                <span className="font-semibold tabular-nums">{inr(applied.finalAmount)}</span>
              </p>
            )}
            <p className="faint mt-2 text-[11px] leading-snug">
              Your final total is in the price summary, and is confirmed on the next screen.
            </p>
          </div>
        )}
      </section>
    );
  }

  /* --------------------------------------------------------------- entry form */
  const kind = error ? inferKind(errorKind, error) : null;
  const showError = Boolean(error) && !isChecking && code.trim() === lastTried.current;
  const copy = kind ? COPY[kind] : null;
  const hint = copy ? (copy.hint ?? error) : null; // 'minimum' / 'rejected' carry the server's own wording
  const ErrIcon = kind === 'network' ? WifiOff : copy?.tone === 'warn' ? TriangleAlert : CircleAlert;
  const toneCls =
    copy?.tone === 'warn'
      ? 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100'
      : 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200';

  return (
    <section
      aria-label="Promo code"
      className={`rounded-2xl border bg-white p-4 shadow-sm transition duration-200 dark:bg-ink-900 ${
        disabled
          ? 'border-sand-200 opacity-80 dark:border-ink-700'
          : 'border-sand-200 focus-within:border-ink-800 focus-within:shadow-md dark:border-ink-700 dark:focus-within:border-sand-300'
      }`}
    >
      <style>{CSS}</style>

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sand-100 text-ink-800 dark:bg-ink-800 dark:text-sand-200"
        >
          <TicketPercent className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <label htmlFor="coupon-code" className="block text-sm font-bold dark:text-sand-50">
            Have a promo code?
          </label>
          <p className="faint text-xs">Enter it to see your saving before you pay.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            id="coupon-code"
            className="field w-full pr-11 font-mono text-base uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
            placeholder="e.g. TRAVEL20"
            value={code}
            disabled={disabled || isChecking}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            aria-invalid={showError || undefined}
            aria-describedby="coupon-feedback"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleApply();
              }
            }}
          />
          {code && !disabled && !isChecking && (
            <button
              type="button"
              onClick={() => setCode('')}
              aria-label="Clear code"
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-sand-500 transition hover:bg-sand-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-sand-100"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn-primary min-h-11 w-full shrink-0 gap-2 sm:w-auto sm:min-w-[6.5rem]"
          onClick={handleApply}
          disabled={!canApply}
          aria-busy={isChecking}
        >
          {isChecking ? (
            <>
              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              Checking…
            </>
          ) : (
            'Apply'
          )}
        </button>
      </div>

      <div id="coupon-feedback" className="empty:hidden">
        {disabled && (
          <p className="faint mt-3 flex items-center gap-2 text-xs">
            <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Select a departure date first to apply a promo code.
          </p>
        )}
        {isChecking && (
          <p className="faint mt-3 text-xs" role="status">
            Checking your code…
          </p>
        )}
        {showError && copy && (
          <div role="alert" className={`cc-pop mt-3 flex items-start gap-2.5 rounded-xl p-3 text-xs sm:text-sm ${toneCls}`}>
            <ErrIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">{copy.title}</p>
              {hint && <p className="mt-0.5 opacity-90">{hint}</p>}
              {kind === 'minimum' && <p className="mt-0.5 opacity-90">Adding travellers or upgrades raises the order total.</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
