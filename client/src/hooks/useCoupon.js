import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';

export function useCoupon({ tourId, slotId, seatCount, selectedOptions }) {
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState(null);
  const [couponAmount, setCouponAmount] = useState(0);
  
  const optionsKey = useMemo(() => JSON.stringify(selectedOptions ?? {}), [selectedOptions]);

  const { mutate, reset, isPending, isError, error } = useMutation({
    mutationFn: (rawCode) =>
      api.validateCoupon({
        tourId,
        slotId,
        seatCount,
        selectedOptions,
        couponCode: rawCode,
      }),
    onSuccess: (data, rawCode) => {
      const couponData = data?.coupon ?? data ?? {};
      setApplied({ ...couponData, code: rawCode.toUpperCase() });
      // Extract the amount here instead of onSettled. 
      // Adjust .discountAmount to match your API's exact key (e.g., discountValue)
      setCouponAmount(couponData.discountAmount ?? couponData.discountValue ?? 0);
    },
  });

  useEffect(() => {
    setApplied(null);
    setCouponAmount(0); // Reset amount when dependencies change
    reset();
  }, [slotId, seatCount, optionsKey, reset]);

  const apply = useCallback(() => {
    const trimmed = code.trim();
    if (!trimmed || !slotId) return;
    mutate(trimmed);
  }, [code, slotId, mutate]);

  const clear = useCallback(() => {
    setApplied(null);
    setCode('');
    setCouponAmount(0); // Reset amount when cleared
    reset();
  }, [reset]);

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
    applied, 
    appliedCode: applied?.code ?? null, 
    couponAmount, 
  };
}