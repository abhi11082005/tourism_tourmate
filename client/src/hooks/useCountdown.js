import { useEffect, useRef, useState } from 'react';

/**
 * Counts down to an absolute deadline instead of decrementing a number, so a
 * backgrounded phone tab (where timers are throttled) still shows the truth when
 * it wakes up. Used by the 10-minute seat-hold banner in checkout.
 *
 * @param {string|null} expiresAt ISO timestamp from the API
 * @param {() => void} [onExpire]
 */
export function useCountdown(expiresAt, onExpire) {
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(expiresAt));
  const fired = useRef(false);
  const callback = useRef(onExpire);
  callback.current = onExpire;

  useEffect(() => {
    fired.current = false;
    setSecondsLeft(remaining(expiresAt));
    if (!expiresAt) return;

    const id = setInterval(() => {
      const left = remaining(expiresAt);
      setSecondsLeft(left);
      if (left <= 0 && !fired.current) {
        fired.current = true;
        clearInterval(id);
        callback.current?.();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [expiresAt]);

  return secondsLeft;
}

function remaining(expiresAt) {
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}
