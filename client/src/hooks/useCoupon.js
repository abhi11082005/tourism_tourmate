import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';

/*
 * Coupon preview for the booking rail.
 *
 * POST /bookings/validate-coupon answers
 *     { coupon: { id, code, discountType, discountValue }, discountAmount, finalAmount }
 * where discountAmount / finalAmount are rupee strings the SERVER worked out against
 * the live quote. The UI only ever displays these — it never derives a discount.
 *
 * A validated code is only true for the exact inputs it was checked against, so any
 * change to the date, party size or options drops it (the discount may no longer
 * hold: a minimum order, a different total). `generation` also stops a slow response
 * from a superseded request from re-applying a stale discount after that reset.
 *
 * Returned (unchanged): code, setCode, apply, clear, isChecking, error, applied,
 * appliedCode, couponAmount. Added: errorKind / errorCode, so the UI can tell a bad
 * code from a flaky network.
 */

const KIND_BY_CODE = {
  COUPON_INVALID: 'invalid',
  COUPON_EXPIRED: 'expired',
  COUPON_EXHAUSTED: 'exhausted',
  COUPON_MIN_NOT_MET: 'minimum',
};

/**
 * 'invalid' | 'expired' | 'exhausted' | 'minimum'   — the code itself was refused
 * 'rejected'                                         — refused for another reason; show the server text
 * 'rate'                                             — too many attempts (HTTP 429)
 * 'unavailable'                                      — our side is having a moment (5xx / 404 / unknown)
 * 'network'                                          — the request never got an answer (offline, DNS…)
 */
function classify(error) {
  if (!error) return null;
  if (!(error instanceof ApiError)) return 'network'; // fetch() itself threw
  if (KIND_BY_CODE[error.code]) return KIND_BY_CODE[error.code];
  if (error.status === 429) return 'rate';
  if (error.code === 'UNKNOWN' || error.status === 404 || error.status >= 500) return 'unavailable';
  return 'rejected';
}

export function useCoupon({ tourId, slotId, seatCount, selectedOptions }) {
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState(null);
  const [couponAmount, setCouponAmount] = useState(0);

  const optionsKey = useMemo(() => JSON.stringify(selectedOptions ?? {}), [selectedOptions]);
  const generation = useRef(0);

  const { mutate, reset, isPending, isError, error } = useMutation({
    mutationFn: ({ rawCode }) =>
      api.validateCoupon({
        tourId,
        slotId,
        seatCount,
        selectedOptions,
        couponCode: rawCode,
      }),
    onSuccess: (data, { rawCode, gen }) => {
      // The inputs changed (or the coupon was cleared) while this was in flight.
      if (gen !== generation.current) return;
      const { coupon, discountAmount, finalAmount } = data ?? {};
      setApplied({
        ...(coupon ?? {}),
        code: (coupon?.code ?? rawCode).toUpperCase(),
        discountAmount,
        finalAmount,
      });
      // Use the server's computed rupee amount — `coupon.discountValue` is the coupon's
      // face value (e.g. 10 for "10% off"), not what this order saves.
      const amount = Number(discountAmount);
      setCouponAmount(Number.isFinite(amount) ? amount : 0);
    },
  });

  useEffect(() => {
    generation.current += 1;
    setApplied(null);
    setCouponAmount(0);
    reset();
  }, [slotId, seatCount, optionsKey, reset]);

  const apply = useCallback(() => {
    const trimmed = code.trim();
    if (!trimmed || !slotId || isPending) return;
    mutate({ rawCode: trimmed, gen: generation.current });
  }, [code, slotId, isPending, mutate]);

  const clear = useCallback(() => {
    generation.current += 1;
    setApplied(null);
    setCode('');
    setCouponAmount(0);
    reset();
  }, [reset]);

  const errorKind = isError ? classify(error) : null;

  const errorMessage = useMemo(() => {
    if (!isError || !error) return null;
    if (errorKind === 'network') return 'You appear to be offline. Check your connection and try again.';
    if (errorKind === 'unavailable') {
      return "We couldn't check that code right now. You can still book at the listed price.";
    }
    return error.message ?? 'That code could not be applied.';
  }, [isError, error, errorKind]);

  return {
    code,
    setCode,
    apply,
    clear,
    isChecking: isPending,
    error: errorMessage,
    errorKind,
    errorCode: error instanceof ApiError ? error.code : null,
    applied,
    appliedCode: applied?.code ?? null,
    couponAmount,
  };
}
