import { useEffect, useState } from 'react';

/** Trails `value` by `delay` ms — the viewport query waits for the pan to settle. */
export function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
