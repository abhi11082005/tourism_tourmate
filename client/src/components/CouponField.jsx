import { useEffect, useRef } from 'react';
import { useCoupon } from '../hooks/useCoupon.js';
import { inr } from '../lib/format.js';

export default function CouponField({ tourId, slotId, seatCount, selectedOptions, onAppliedChange, onAmountChange }) {
  const { code, setCode, apply, clear, isChecking, error, applied, appliedCode, couponAmount } = useCoupon({
    tourId,
    slotId,
    seatCount,
    selectedOptions,
  });
  
  console.log("applied coupon amount in CouponField:", couponAmount);

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