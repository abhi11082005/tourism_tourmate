import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';

/*
 * Coupon entry for the booking rail — and the single most important sentence about
 * it: this runs BEFORE the seat hold. The traveller types a code, we ask the server
 * what it's worth for *this* slot/seat/options combination, and only once they
 * commit does the caller fold `appliedCode` into api.checkout (which is what creates
 * the 10-minute Redis hold). Validating first means we never lock inventory for a
 * price the coupon was going to change.
 *
 * Money is never computed here. The server returns discountAmount and finalAmount as
 * NUMERIC strings; the component renders them through inr() verbatim.
 *
 * Failure is soft. A genuinely bad code comes back with a friendly server message; a
 * missing route (offer engine not deployed yet) collapses to one calm line instead of
 * a red crash, so the rest of the booking rail keeps working.
 */

export function useCoupon({ tourId, slotId, seatCount, selectedOptions }) {
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState(null);

  // selectedOptions is a fresh object every render; stringify it so the reset effect
  // below fires on a real change of choices, not on identity churn.
  const optionsKey = useMemo(() => JSON.stringify(selectedOptions ?? {}), [selectedOptions]);

  const { mutate, reset, isPending, isError, error } = useMutation({
    mutationFn: (rawCode) =>
      api.validateCoupon({
        tourId,
        slotId,
        seatCount,
        selectedOptions,
        code: rawCode,
      }),
    onSuccess: (data, rawCode) =>
      setApplied({ ...(data?.coupon ?? data ?? {}), code: rawCode.toUpperCase() }),
  });

  /*
   * Drop an applied coupon the moment the thing it was priced against changes. A
   * "₹500 off" validated for 2 seats on the 6th must not silently ride along to 4
   * seats on the 9th — the server would reject or re-price it at checkout anyway, and
   * showing a stale discount until then is a lie about the total.
   */
  useEffect(() => {
    setApplied(null);
    reset();
  }, [slotId, seatCount, optionsKey, reset]);

  const apply = useCallback(() => {
    const trimmed = code.trim();
    // No slot picked yet means there is nothing to price the code against.
    if (!trimmed || !slotId) return;
    mutate(trimmed);
  }, [code, slotId, mutate]);

  const clear = useCallback(() => {
    setApplied(null);
    setCode('');
    reset();
  }, [reset]);

  // A missing route (offer engine not live) throws with no server code; treat that as
  // "unavailable" rather than surfacing a raw "Not Found" at the traveller.
  const errorMessage = useMemo(() => {
    if (!isError || !error) return null;
    if (error instanceof ApiError && (error.code === 'UNKNOWN' || error.status === 404)) {
      return "We couldn't check that code right now. You can still book at the listed price.";
    }
    return error.message ?? 'That code could not be applied.';
  }, [isError, error]);

  return {
    code,
    setCode,
    apply,
    clear,
    isChecking: isPending,
    error: errorMessage,
    applied, // { code, label?, discountAmount, finalAmount, ... } — display only
    appliedCode: applied?.code ?? null, // thread into api.checkout on commit
  };
}
