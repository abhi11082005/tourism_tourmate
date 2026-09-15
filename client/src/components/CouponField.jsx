import { useEffect, useRef } from 'react';
import { useCoupon } from '../hooks/useCoupon.js';
import { inr } from '../lib/format.js';

/*
 * Coupon entry for the booking rail. The whole reason it lives *here* and not on the
 * checkout page: the code has to be priced BEFORE the "hold my seats for 10 minutes"
 * button fires, so we never lock inventory against a total the coupon was about to
 * change. This field previews the discount; the parent folds `appliedCode` into
 * api.checkout when the traveller commits.
 *
 * All amounts shown come straight from the server's validate response — this
 * component does no arithmetic. It just displays what the code is worth for the slot
 * and seat count currently selected, and reports the applied code upward.
 */

export default function CouponField({ tourId, slotId, seatCount, selectedOptions, onAppliedChange }) {
  const { code, setCode, apply, clear, isChecking, error, applied, appliedCode } = useCoupon({
    tourId,
    slotId,
    seatCount,
    selectedOptions,
  });

  // Report the applied code up without making the parent's callback identity a
  // dependency (it's usually an inline arrow), which would loop the effect.
  const notify = useRef(onAppliedChange);
  notify.current = onAppliedChange;
  useEffect(() => {
    notify.current?.(appliedCode);
  }, [appliedCode]);

  const disabled = !slotId;

  if (applied) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">
            <span className="font-mono">{applied.code}</span> applied
          </p>
          <button
            type="button"
            onClick={clear}
            className="text-xs font-semibold text-emerald-800 underline underline-offset-2 dark:text-emerald-200"
          >
            Remove
          </button>
        </div>
        {(applied.discountAmount != null || applied.finalAmount != null) && (
          <p className="mt-1 text-emerald-800 dark:text-emerald-200">
            {applied.discountAmount != null && <>You save {inr(applied.discountAmount)}</>}
            {applied.finalAmount != null && (
              <>
                {applied.discountAmount != null ? ' · ' : ''}
                new total <span className="font-semibold">{inr(applied.finalAmount)}</span>
              </>
            )}
          </p>
        )}
        <p className="faint mt-1 text-[11px]">Final price is confirmed on the next screen.</p>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium" htmlFor="coupon-code">
        Have a coupon?
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="coupon-code"
          className="field font-mono uppercase"
          placeholder="MONSOON20"
          value={code}
          disabled={disabled || isChecking}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={apply}
          disabled={disabled || isChecking || code.trim().length < 3}
        >
          {isChecking ? 'Checking…' : 'Apply'}
        </button>
      </div>
      {disabled && <p className="faint mt-1 text-xs">Pick a date first to check a code.</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}
